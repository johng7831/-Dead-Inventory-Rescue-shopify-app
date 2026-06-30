import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ==========================================
// 1. LOADER: Calculates dynamic dates & pulls slow-movers
// ==========================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  const url = new URL(request.url);
  const lookbackDays = parseInt(url.searchParams.get("days") || "30", 10);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffDateISO = cutoffDate.toISOString();

  const response = await admin.graphql(
    `#graphql
    query getStagnantInventory($orderQuery: String!) {
      products(first: 50) {
        edges {
          node {
            id
            title
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  inventoryQuantity
                }
              }
            }
          }
        }
      }
      orders(first: 100, query: $orderQuery) {
        edges {
          node {
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
    { variables: { orderQuery: `created_at:>=${cutoffDateISO}` } }
  );

  const responseJson = await response.json();
  const allProducts = responseJson.data?.products?.edges || [];
  const recentOrders = responseJson.data?.orders?.edges || [];

  const activeProductIds = new Set();
  recentOrders.forEach(({ node: order }) => {
    order.lineItems?.edges?.forEach(({ node: item }) => {
      if (item.product?.id) {
        activeProductIds.add(item.product.id);
      }
    });
  });

  const deadStockProducts = [];

  allProducts.forEach(({ node: product }) => {
    const hasSales = activeProductIds.has(product.id);
    
    if (!hasSales) {
      let totalQty = 0;
      let samplePrice = "0.00";

      product.variants?.edges?.forEach(({ node: variant }) => {
        totalQty += variant.inventoryQuantity || 0;
        if (variant.price) samplePrice = variant.price;
      });

      if (totalQty > 0) {
        deadStockProducts.push({
          id: product.id,
          title: product.title,
          qty: totalQty,
          price: parseFloat(samplePrice).toLocaleString("en-US", { style: "currency", currency: "USD" }),
        });
      }
    }
  });

  return { 
    deadStockProducts,
    currentDaysApplied: lookbackDays
  };
};

// ==========================================
// 2. UI VIEW: Clean dynamic filtering dashboard
// ==========================================
export default function StagnantFilterDashboard() {
  const { deadStockProducts, currentDaysApplied } = useLoaderData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const [filterDays, setFilterDays] = useState(currentDaysApplied);

  const handleFilterUpdate = (daysValue) => {
    setFilterDays(daysValue);
    submit({ days: daysValue }, { method: "GET" });
  };

  // Modern SaaS Container Card Styling
  const layoutCard = { 
    background: "#fff", 
    padding: "24px", 
    borderRadius: "16px", 
    border: "1px solid #e2e8f0", 
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.02)",
    marginBottom: "24px" 
  };

  // Colorful Premium Filter Action Button States
  const filterBtn = (val) => ({
    padding: "10px 20px",
    borderRadius: "20px",
    border: filterDays === val ? "none" : "1px solid #cbd5e1",
    background: filterDays === val ? "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)" : "#fff",
    color: filterDays === val ? "#fff" : "#334155",
    fontWeight: "700",
    fontSize: "13px",
    cursor: "pointer",
    boxShadow: filterDays === val ? "0 4px 10px rgba(59, 130, 246, 0.25)" : "none",
    transition: "all 0.2s ease"
  });

  return (
    <s-page style={{ fontFamily: "system-ui, sans-serif", padding: "12px 0" }}>
      
      {/* HEADER ROW */}
      <div style={{ marginBottom: "28px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: "800", margin: "0 0 6px 0", background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.03em" }}>
          Dead Stock Finder
        </h1>
        <p style={{ color: "#64748b", fontSize: "14px", margin: "0", fontWeight: "500" }}>
          Isolate specific products that haven't generated a single sale across custom calendar windows.
        </p>
      </div>

      {/* DYNAMIC TIME FILTER CONTROLLER */}
      <div style={layoutCard}>
        <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "14px" }}>
          Select Stagnant Inactivity Window:
        </label>
        
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={filterBtn(7)} onClick={() => handleFilterUpdate(7)}>Last 7 Days</button>
          <button style={filterBtn(30)} onClick={() => handleFilterUpdate(30)}>Last 30 Days</button>
          <button style={filterBtn(60)} onClick={() => handleFilterUpdate(60)}>Last 60 Days</button>
          
          <span style={{ color: "#94a3b8", fontSize: "14px", fontWeight: "600", margin: "0 4px" }}>or custom lookback:</span>
          
          <div style={{ position: "relative", display: "inline-block" }}>
            <input 
              type="number" 
              placeholder="Days"
              value={filterDays}
              onChange={(e) => setFilterDays(e.target.value)}
              onBlur={(e) => handleFilterUpdate(e.target.value || 30)}
              style={{ 
                width: "120px", 
                padding: "9px 32px 9px 14px", 
                border: "2px solid #e2e8f0", 
                borderRadius: "12px", 
                fontSize: "14px",
                fontWeight: "600",
                color: "#1e293b",
                outline: "none"
              }}
            />
            <span style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", fontSize: "12px", fontWeight: "700", color: "#94a3b8" }}>d</span>
          </div>
        </div>
      </div>

      {/* DYNAMIC PRODUCTS OUTPUT DISPLAY PANEL */}
      <div style={layoutCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", paddingBottom: "14px", borderBottom: "2px solid #f1f5f9" }}>
          <h2 style={{ fontSize: "16px", fontWeight: "800", margin: "0", color: "#1e293b" }}>
            Stagnant Pipeline Results ({deadStockProducts.length} items found)
          </h2>
          {isLoading && (
            <span style={{ fontSize: "13px", color: "#2563eb", fontWeight: "700", animation: "pulse 1.5s infinite" }}>
              ⚡ Syncing data fields...
            </span>
          )}
        </div>

        {deadStockProducts.length === 0 ? (
          <div style={{ 
            background: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)", 
            border: "1px solid #a7f3d0", 
            borderRadius: "12px", 
            padding: "32px 16px", 
            textAlign: "center", 
            color: "#065f46", 
            fontSize: "15px",
            fontWeight: "600"
          }}>
            🎉 Great news! All catalog products have generated channel conversions within the past {currentDaysApplied} days.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e2e8f0", color: "#475569" }}>
                  <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Product Variant Title</th>
                  <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Available Inventory</th>
                  <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Storefront Price</th>
                  <th style={{ padding: "16px 24px", fontWeight: "700", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Status Trigger</th>
                </tr>
              </thead>
              <tbody>
                {deadStockProducts.map((product) => (
                  <tr 
                    key={product.id} 
                    style={{ borderBottom: "1px solid #f1f5f9", color: "#334155", transition: "background 0.15s ease" }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#f8fafc"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                  >
                    <td style={{ padding: "16px 24px", fontWeight: "700", color: "#1e293b", fontSize: "15px" }}>{product.title}</td>
                    <td style={{ padding: "16px 24px", color: "#ef4444", fontWeight: "700" }}>{product.qty} units left</td>
                    <td style={{ padding: "16px 24px", fontWeight: "600", color: "#64748b" }}>{product.price}</td>
                    <td style={{ padding: "16px 24px" }}>
                      <span style={{ 
                        padding: "5px 12px", 
                        background: "#fff5f5", 
                        color: "#e03131", 
                        borderRadius: "8px", 
                        fontSize: "12px", 
                        fontWeight: "700",
                        border: "1px solid #ffc9c9",
                        display: "inline-block"
                      }}>
                        0 Sales / {currentDaysApplied} Days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};