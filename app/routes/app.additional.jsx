import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ==========================================
// 1. LOADER: Fetches Products & Orders
// ==========================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  const response = await admin.graphql(
    `#graphql
    query getInventoryMetricsAndOrders($orderQuery: String!) {
      products(first: 50) {
        edges {
          node {
            id
            title
            variants(first: 20) {
              edges {
                node {
                  id
                  price
                  inventoryQuantity
                  inventoryItem {
                    unitCost {
                      amount
                    }
                  }
                }
              }
            }
          }
        }
      }
      orders(first: 50, query: $orderQuery) {
        edges {
          node {
            id
            lineItems(first: 10) {
              edges {
                node {
                  product {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { orderQuery: `created_at:>=${sevenDaysAgoISO}` } }
  );

  const responseJson = await response.json();
  const allProducts = responseJson.data?.products?.edges || [];
  const recentOrders = responseJson.data?.orders?.edges || [];

  const orderedProductIds = new Set();
  recentOrders.forEach(({ node: order }) => {
    order.lineItems?.edges?.forEach(({ node: item }) => {
      if (item.product?.id) {
        orderedProductIds.add(item.product.id);
      }
    });
  });

  const tableItemsList = [];

  allProducts.forEach(({ node: product }) => {
    const isDead = !orderedProductIds.has(product.id);
    
    if (isDead) {
      let productTotalQty = 0;
      let productCapitalTiedValue = 0;
      let samplePrice = 0;

      product.variants?.edges?.forEach(({ node: variant }) => {
        const quantity = variant.inventoryQuantity || 0;
        const costPerItem = parseFloat(variant.inventoryItem?.unitCost?.amount || variant.price || 0);
        
        if (quantity > 0) {
          productTotalQty += quantity;
          productCapitalTiedValue += (quantity * costPerItem);
        }
        if (!samplePrice && variant.price) {
          samplePrice = parseFloat(variant.price);
        }
      });

      if (productTotalQty > 0) {
        tableItemsList.push({
          id: product.id,
          productTitle: product.title,
          qty: productTotalQty,
          daysUnsold: 7, 
          price: samplePrice.toLocaleString("en-US", { style: "currency", currency: "USD" }),
          capitalTied: productCapitalTiedValue.toLocaleString("en-US", { style: "currency", currency: "USD" }),
          rawCapitalTied: productCapitalTiedValue
        });
      }
    }
  });

  tableItemsList.sort((a, b) => b.rawCapitalTied - a.rawCapitalTied);

  return { deadStockTableItems: tableItemsList };
};

// ==========================================
// 2. ACTION: Creates Code Coupons on Shopify
// ==========================================
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const productId = formData.get("productId");
  const productTitle = formData.get("productTitle");
  const couponCode = formData.get("couponCode").trim().toUpperCase();
  const discountPercent = parseFloat(formData.get("discountPercent")) / 100;

  const response = await admin.graphql(
    `#graphql
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        basicCodeDiscount: {
          title: `${formData.get("discountPercent")}% Off ${productTitle}`,
          code: couponCode,
          startsAt: new Date().toISOString(),
          customerGets: {
            value: {
              percentage: discountPercent
            },
            items: {
              products: {
                productsToAdd: [productId]
              }
            }
          },
          customerSelection: {
            all: true
          },
          minimumRequirement: {
            quantity: {
              greaterThanOrEqualToQuantity: "1"
            }
          }
        }
      }
    }
  );

  const responseJson = await response.json();
  return { 
    success: !responseJson.data?.discountCodeBasicCreate?.userErrors?.length,
    codeCreated: couponCode,
    errors: responseJson.data?.discountCodeBasicCreate?.userErrors || []
  };
};

// ==========================================
// 3. UI DASHBOARD WITH POPUP DIALOGUE
// ==========================================
export default function Index() {
  const { deadStockTableItems } = useLoaderData();
  const fetcher = useFetcher();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState("20");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setSuccessMessage(`Coupon code "${fetcher.data.codeCreated}" successfully created!`);
      const timer = setTimeout(() => setSuccessMessage(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  const openDiscountModal = (item) => {
    setSelectedProduct(item);
    setCouponCode(`SAVE-${item.productTitle.replace(/\s+/g, "-").substring(0, 10).toUpperCase()}`);
    setIsModalOpen(true);
  };

  const handleModalSubmit = (e) => {
    e.preventDefault();
    if (!couponCode) return;

    fetcher.submit(
      {
        productId: selectedProduct.id,
        productTitle: selectedProduct.productTitle,
        couponCode: couponCode,
        discountPercent: discountPercent,
      },
      { method: "post" }
    );

    setIsModalOpen(false);
  };

  return (
    <s-page style={{ position: "relative", fontFamily: "system-ui, sans-serif", padding: "12px 0" }}>
      
      {/* SUCCESS ALERTER BANNER */}
      {successMessage && (
        <div style={{ 
          background: "linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)", 
          border: "1px solid #10b981", 
          borderRadius: "12px", 
          padding: "14px 20px", 
          marginBottom: "24px",
          display: "flex",
          alignItems: "center",
          fontSize: "14px",
          fontWeight: "600",
          color: "#047857",
          boxShadow: "0 4px 12px rgba(16, 185, 129, 0.1)",
          animation: "fadeIn 0.3s ease"
        }}>
          <span style={{ marginRight: "10px", fontSize: "16px" }}>🎉</span> 
          {successMessage}
        </div>
      )}

      {/* TABLE LIST CONTAINER */}
      <s-section heading="Dead Stock Campaign Manager">
        <div style={{ 
          background: "#fff", 
          border: "1px solid #e2e8f0", 
          borderRadius: "16px", 
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.03)", 
          overflow: "hidden", 
          marginTop: "16px" 
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Product Details</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Qty Instock</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Days Unsold</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Price</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Capital Tied Up</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em", textAlign: "right" }}>Marketing Action</th>
              </tr>
            </thead>
            <tbody>
              {deadStockTableItems.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: "48px 24px", textAlign: "center", color: "#64748b", fontSize: "14px", fontWeight: "500" }}>
                    Your catalog is clear! No stagnant stock found.
                  </td>
                </tr>
              ) : (
                deadStockTableItems.map((item) => {
                  const isSubmitting = fetcher.formData?.get("productId") === item.id;
                  
                  return (
                    <tr 
                      key={item.id} 
                      style={{ borderBottom: "1px solid #f1f5f9", color: "#334155", transition: "background 0.15s ease" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                      <td style={{ padding: "16px 24px" }}>
                        <div style={{ fontWeight: "700", color: "#1e293b", fontSize: "15px" }}>{item.productTitle}</div>
                      </td>
                      <td style={{ padding: "16px 24px", fontWeight: "600", color: "#475569" }}>{item.qty}</td>
                      <td style={{ padding: "16px 24px" }}>
                        <span style={{ color: "#ea580c", background: "#fff7ed", padding: "4px 10px", borderRadius: "8px", fontWeight: "700", fontSize: "12px", border: "1px solid #ffedd5" }}>
                          {item.daysUnsold} Days
                        </span>
                      </td>
                      <td style={{ padding: "16px 24px", color: "#64748b" }}>{item.price}</td>
                      <td style={{ padding: "16px 24px", fontWeight: "700", color: "#ef4444", fontSize: "15px" }}>{item.capitalTied}</td>
                      <td style={{ padding: "16px 24px", textAlign: "right" }}>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => openDiscountModal(item)}
                          style={{
                            background: isSubmitting ? "#e2e8f0" : "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
                            color: isSubmitting ? "#94a3b8" : "#fff",
                            border: "none",
                            padding: "8px 16px",
                            borderRadius: "20px",
                            fontSize: "13px",
                            fontWeight: "700",
                            cursor: isSubmitting ? "not-allowed" : "pointer",
                            boxShadow: isSubmitting ? "none" : "0 4px 10px rgba(59, 130, 246, 0.25)",
                            transition: "all 0.2s ease"
                          }}
                        >
                          {isSubmitting ? "Creating Code..." : "Apply Discount"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </s-section>

      {/* POPUP COUPON MODAL DIALOGUE */}
      {isModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          backgroundColor: "rgba(15, 23, 42, 0.4)", display: "flex", justifyContent: "center", alignItems: "center", 
          zIndex: 9999, backdropFilter: "blur(4px)"
        }}>
          <div style={{ 
            background: "#fff", 
            padding: "32px", 
            borderRadius: "20px", 
            width: "440px", 
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
            border: "1px solid #f1f5f9",
            animation: "scaleUp 0.2s ease-out"
          }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "20px", fontWeight: "800", color: "#0f172a", letterSpacing: "-0.02em" }}>
              Configure Flash Promotion
            </h3>
            <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#64748b" }}>
              Product Target: <span style={{ fontWeight: "700", color: "#3b82f6" }}>{selectedProduct?.productTitle}</span>
            </p>
            
            <form onSubmit={handleModalSubmit}>
              <div style={{ marginBottom: "16px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", marginBottom: "6px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Promo Coupon Code
                </label>
                <input 
                  type="text" 
                  value={couponCode} 
                  onChange={(e) => setCouponCode(e.target.value)} 
                  required
                  style={{ 
                    width: "100%", padding: "12px 14px", borderRadius: "10px", 
                    border: "2px solid #e2e8f0", boxSizing: "border-box", fontSize: "14px", fontWeight: "600",
                    color: "#1e293b", outline: "none", textTransform: "uppercase"
                  }}
                />
              </div>

              <div style={{ marginBottom: "28px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", marginBottom: "6px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                  Discount Target (%)
                </label>
                <div style={{ position: "relative" }}>
                  <input 
                    type="number" 
                    min="1" 
                    max="99"
                    value={discountPercent} 
                    onChange={(e) => setDiscountPercent(e.target.value)} 
                    required
                    style={{ 
                      width: "100%", padding: "12px 14px", borderRadius: "10px", 
                      border: "2px solid #e2e8f0", boxSizing: "border-box", fontSize: "14px", fontWeight: "600",
                      color: "#1e293b", outline: "none"
                    }}
                  />
                  <span style={{ position: "absolute", right: "16px", top: "50%", transform: "translateY(-50%)", fontWeight: "700", color: "#94a3b8" }}>%</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  style={{ 
                    background: "#f8fafc", border: "1px solid #e2e8f0", padding: "10px 20px", 
                    borderRadius: "12px", cursor: "pointer", fontWeight: "600", color: "#64748b", fontSize: "14px"
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  style={{ 
                    background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)", color: "#fff", 
                    border: "none", padding: "10px 24px", borderRadius: "12px", fontWeight: "700", 
                    cursor: "pointer", fontSize: "14px", boxShadow: "0 4px 12px rgba(14, 165, 233, 0.2)"
                  }}
                >
                  Activate Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};