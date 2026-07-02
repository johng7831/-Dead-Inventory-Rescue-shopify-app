import { useLoaderData, useRevalidator } from "react-router"; 
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

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
    {
      variables: {
        orderQuery: `created_at:>=${sevenDaysAgoISO}`,
      },
    }
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

  let totalProductsCount = allProducts.length;
  let deadInventoryCount = 0;
  let inventoryValue = 0;
  const tableItemsList = [];

  allProducts.forEach(({ node: product }) => {
    const isDead = !orderedProductIds.has(product.id);
    
    if (isDead) {
      deadInventoryCount += 1;
      
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

      inventoryValue += productCapitalTiedValue;

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

  const estimatedRecovery = inventoryValue * 0.28;

  return {
    deadStockTableItems: tableItemsList,
    metrics: {
      totalProducts: totalProductsCount,
      deadInventory: deadInventoryCount,
      inventoryValue: inventoryValue.toLocaleString("en-US", { style: "currency", currency: "USD" }),
      estimatedRecovery: estimatedRecovery.toLocaleString("en-US", { style: "currency", currency: "USD" }),
    }
  };
};

export default function Index() {
  const { metrics, deadStockTableItems } = useLoaderData();
  const revalidator = useRevalidator(); 

  const handleScanNow = () => {
    if (revalidator.state === "idle") {
      revalidator.revalidate(); 
    }
  };

  return (
    <s-page>
      {/* HEADER SECTION */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: "800", margin: 0, background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.03em" }}>
            IdleStock Dashboard
          </h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#64748b", fontWeight: "500" }}>
            System Sync: <span style={{ color: "#3b82f6" }}>{new Date().toLocaleDateString()}</span>
          </p>
        </div>
        <button 
          onClick={handleScanNow}
          disabled={revalidator.state === "loading"}
          style={{
            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
            color: "#fff",
            border: "none",
            padding: "10px 20px",
            borderRadius: "20px",
            fontWeight: "600",
            cursor: revalidator.state === "loading" ? "not-allowed" : "pointer",
            opacity: revalidator.state === "loading" ? 0.7 : 1,
            fontSize: "14px",
            boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)",
            transition: "all 0.2s ease"
          }}
        >
          {revalidator.state === "loading" ? "Analyzing Store..." : "Scan Now"}
        </button>
      </div>

      {/* SCAN CONFIRMATION BANNER */}
      <div style={{ 
        background: "linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%)", 
        border: "1px solid #10b981", 
        borderRadius: "12px", 
        padding: "14px 20px", 
        marginBottom: "28px",
        display: "flex",
        alignItems: "center",
        fontSize: "14px",
        fontWeight: "600",
        color: "#047857",
        boxShadow: "0 2px 4px rgba(16, 185, 129, 0.05)"
      }}>
        <span style={{ marginRight: "10px", fontSize: "18px" }}></span> 
        Optimization engine complete! {metrics.totalProducts} items analyzed for dead stock trends.
      </div>
      
      {/* METRICS OVERVIEW CARDS ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px", marginBottom: "32px" }}>
        
        {/* Card 1: Blue Theme */}
        <div style={{ background: "linear-gradient(135deg, #f0f7ff 0%, #e0f2fe 100%)", border: "1px solid #bae6fd", borderRadius: "14px", padding: "20px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "#0369a1", letterSpacing: "0.05em", marginBottom: "6px" }}>Total Products</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#0c4a6e" }}>{metrics.totalProducts}</div>
        </div>

        {/* Card 2: Orange/Red Theme */}
        <div style={{ background: "linear-gradient(135deg, #fff5f5 0%, #ffe3e3 100%)", border: "1px solid #ffa8a8", borderRadius: "14px", padding: "20px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "#c92a2a", letterSpacing: "0.05em", marginBottom: "6px" }}>Dead Inventory</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#e03131" }}>{metrics.deadInventory}</div>
        </div>

        {/* Card 3: Violet Theme */}
        <div style={{ background: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)", border: "1px solid #e9d5ff", borderRadius: "14px", padding: "20px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "#6b21a8", letterSpacing: "0.05em", marginBottom: "6px" }}>Inventory Value</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#4c1d95" }}>{metrics.inventoryValue}</div>
        </div>

        {/* Card 4: Emerald Green Theme */}
        <div style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", border: "1px solid #a7f3d0", borderRadius: "14px", padding: "20px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" }}>
          <div style={{ fontSize: "12px", fontWeight: "700", textTransform: "uppercase", color: "#065f46", letterSpacing: "0.05em", marginBottom: "6px" }}>Estimated Recovery</div>
          <div style={{ fontSize: "28px", fontWeight: "800", color: "#064e3b" }}>{metrics.estimatedRecovery}</div>
        </div>
      </div>

      {/* PRODUCTS TABLE DISPLAY */}
      <s-section heading="Dead Stock Items">
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.02)", overflow: "hidden", marginTop: "16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0", color: "#475569" }}>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px" }}>Product Title</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px" }}>Qty</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px" }}>Days Unsold</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px" }}>Retail Price</th>
                <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px" }}>Capital Tied Up</th>
              </tr>
            </thead>
            <tbody>
              {deadStockTableItems.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ padding: "48px 24px", textAlign: "center", color: "#64748b", fontSize: "14px", fontWeight: "500" }}>
                    Your catalog is clear! No stagnant stock found.
                  </td>
                </tr>
              ) : (
                deadStockTableItems.map((item) => (
                  <tr 
                    key={item.id} 
                    style={{ borderBottom: "1px solid #f1f5f9", color: "#334155" }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                  >
                    <td style={{ padding: "16px 24px" }}>
                      <div style={{ fontWeight: "700", color: "#1e293b" }}>{item.productTitle}</div>
                    </td>
                    <td style={{ padding: "16px 24px", fontWeight: "500" }}>{item.qty}</td>
                    <td style={{ padding: "16px 24px" }}>
                      <span style={{ color: "#ea580c", background: "#fff7ed", padding: "3px 8px", borderRadius: "6px", fontWeight: "600", fontSize: "13px" }}>
                        {item.daysUnsold} days
                      </span>
                    </td>
                    <td style={{ padding: "16px 24px", color: "#64748b" }}>{item.price}</td>
                    <td style={{ padding: "16px 24px", fontWeight: "700", color: "#ef4444" }}>{item.capitalTied}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};