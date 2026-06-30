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

  // Modal & Notification State Management
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [couponCode, setCouponCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState("20");
  const [successMessage, setSuccessMessage] = useState("");

  // Listen to fetcher changes to handle a successful creation callback
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setSuccessMessage(`Coupon code "${fetcher.data.codeCreated}" successfully created!`);
      
      // Auto-hide the banner notification alert after 5 seconds
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
    <s-page style={{ position: "relative" }}>
      
      {/* SUCCESS ALERTER BANNER */}
      {successMessage && (
        <div style={{ 
          background: "#f1f8f5", 
          border: "1px solid #a3cfbb", 
          borderRadius: "8px", 
          padding: "12px 16px", 
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          fontSize: "14px",
          color: "#146c43",
          fontWeight: "500"
        }}>
          <span style={{ marginRight: "8px" }}>✓</span> 
          {successMessage}
        </div>
      )}

      <s-section heading="Dead Stock Items">
        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", overflow: "hidden", marginTop: "12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#f6f6f7", borderBottom: "1px solid #e1e3e5", color: "#6d7175" }}>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Product</th>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Qty</th>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Days Unsold</th>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Price</th>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Capital Tied</th>
                <th style={{ padding: "12px 16px", fontWeight: "500" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {deadStockTableItems.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ padding: "32px", textAlign: "center", color: "#6d7175" }}>
                    No dead stock products found.
                  </td>
                </tr>
              ) : (
                deadStockTableItems.map((item) => {
                  const isSubmitting = fetcher.formData?.get("productId") === item.id;
                  
                  return (
                    <tr key={item.id} style={{ borderBottom: "1px solid #e1e3e5", color: "#202123" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ fontWeight: "600", color: "#202123" }}>{item.productTitle}</div>
                      </td>
                      <td style={{ padding: "12px 16px" }}>{item.qty}</td>
                      <td style={{ padding: "12px 16px" }}>{item.daysUnsold}</td>
                      <td style={{ padding: "12px 16px" }}>{item.price}</td>
                      <td style={{ padding: "12px 16px", fontWeight: "600", color: "#b02a37" }}>{item.capitalTied}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => openDiscountModal(item)}
                          style={{
                            background: isSubmitting ? "#e1e3e5" : "#e2f1ff",
                            color: isSubmitting ? "#6d7175" : "#0066cc",
                            border: "none",
                            padding: "6px 14px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: "600",
                            cursor: isSubmitting ? "not-allowed" : "pointer"
                          }}
                        >
                          {isSubmitting ? "Creating..." : "Apply Discount"}
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
          background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999
        }}>
          <div style={{ background: "#fff", padding: "24px", borderRadius: "8px", width: "400px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "600" }}>Configure Coupon Discount</h3>
            <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#6d7175" }}>Product: <strong>{selectedProduct?.productTitle}</strong></p>
            
            <form onSubmit={handleModalSubmit}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#202123" }}>Coupon Code</label>
                <input 
                  type="text" 
                  value={couponCode} 
                  onChange={(e) => setCouponCode(e.target.value)} 
                  required
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #e1e3e5", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "500", marginBottom: "4px", color: "#202123" }}>Discount Percentage (%)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="99"
                  value={discountPercent} 
                  onChange={(e) => setDiscountPercent(e.target.value)} 
                  required
                  style={{ width: "100%", padding: "8px", borderRadius: "4px", border: "1px solid #e1e3e5", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  style={{ background: "#fff", border: "1px solid #e1e3e5", padding: "6px 16px", borderRadius: "4px", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  style={{ background: "#0066cc", color: "#fff", border: "none", padding: "6px 16px", borderRadius: "4px", fontWeight: "600", cursor: "pointer" }}
                >
                  Create Code
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