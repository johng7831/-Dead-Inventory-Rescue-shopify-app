import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ==========================================
// 1. LOADER: Calculates dynamic dates & pulls slow-movers
// ==========================================
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  
  // Extract custom lookup days value from URL search params (defaults to 30 days)
  const url = new URL(request.url);
  const lookbackDays = parseInt(url.searchParams.get("days") || "30", 10);

  // Compute precise date boundary
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffDateISO = cutoffDate.toISOString();

  // Fetch products and recent orders within the dynamic window
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

  // Map out product IDs that had active orders inside our time window
  const activeProductIds = new Set();
  recentOrders.forEach(({ node: order }) => {
    order.lineItems?.edges?.forEach(({ node: item }) => {
      if (item.product?.id) {
        activeProductIds.add(item.product.id);
      }
    });
  });

  const deadStockProducts = [];

  // Filter products that have NOT seen any sales in the specified window
  allProducts.forEach(({ node: product }) => {
    const hasSales = activeProductIds.has(product.id);
    
    if (!hasSales) {
      let totalQty = 0;
      let samplePrice = "0.00";

      product.variants?.edges?.forEach(({ node: variant }) => {
        totalQty += variant.inventoryQuantity || 0;
        if (variant.price) samplePrice = variant.price;
      });

      // Only display items that actually have inventory balance left
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

  // Triggers reload with custom inputs
  const handleFilterUpdate = (daysValue) => {
    setFilterDays(daysValue);
    submit({ days: daysValue }, { method: "GET" });
  };

  // Base Clean UI Styling Blocks
  const layoutCard = { background: "#fff", padding: "20px", borderRadius: "8px", border: "1px solid #e1e3e5", marginBottom: "20px" };
  const filterBtn = (val) => ({
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #b6b7b9",
    background: filterDays === val ? "#007ac1" : "#fff",
    color: filterDays === val ? "#fff" : "#202123",
    fontWeight: "600",
    cursor: "pointer"
  });

  return (
    <s-page>
      {/* HEADER ROW */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#1a1c1d", margin: "0 0 4px 0" }}>Dead Stock Finder</h1>
        <p style={{ color: "#6d7175", fontSize: "13px", margin: "0" }}>Isolate specific products that haven't generated a single sale across custom calendar windows.</p>
      </div>

      {/* DYNAMIC TIME FILTER CONTROLLER */}
      <div style={layoutCard}>
        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#202123", marginBottom: "12px" }}>
          Select Stagnant Inactivity Window:
        </label>
        
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button style={filterBtn(7)} onClick={() => handleFilterUpdate(7)}>Last 7 Days</button>
          <button style={filterBtn(30)} onClick={() => handleFilterUpdate(30)}>Last 30 Days</button>
          <button style={filterBtn(60)} onClick={() => handleFilterUpdate(60)}>Last 60 Days</button>
          
          <span style={{ color: "#6d7175", fontSize: "13px", margin: "0 4px" }}>or custom:</span>
          
          <input 
            type="number" 
            placeholder="Enter days"
            value={filterDays}
            onChange={(e) => setFilterDays(e.target.value)}
            onBlur={(e) => handleFilterUpdate(e.target.value || 30)}
            style={{ width: "110px", padding: "7px 12px", border: "1px solid #b6b7b9", borderRadius: "6px", fontSize: "14px" }}
          />
          <span style={{ fontSize: "13px", color: "#6d7175" }}>Days Unsold</span>
        </div>
      </div>

      {/* DYNAMIC PRODUCTS OUTPUT DISPLAY PANEL */}
      <div style={layoutCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #f1f2f4" }}>
          <h2 style={{ fontSize: "15px", fontWeight: "700", margin: "0", color: "#1a1c1d" }}>
            Stagnant Results ({deadStockProducts.length} items found)
          </h2>
          {isLoading && <span style={{ fontSize: "13px", color: "#0066cc", fontWeight: "500" }}>Refreshing pipeline inventory...</span>}
        </div>

        {deadStockProducts.length === 0 ? (
          <div style={{ padding: "40px 16px", textAlign: "center", color: "#6d7175", fontSize: "14px" }}>
            🎉 Great news! All stocked products have generated conversions within the past <strong>{currentDaysApplied} days</strong>.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", textAlign: "left" }}>
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e1e3e5" }}>
                  <th style={{ padding: "12px", color: "#6d7175", fontWeight: "600" }}>Product Variant Title</th>
                  <th style={{ padding: "12px", color: "#6d7175", fontWeight: "600" }}>Available Inventory</th>
                  <th style={{ padding: "12px", color: "#6d7175", fontWeight: "600" }}>Storefront Price</th>
                  <th style={{ padding: "12px", color: "#6d7175", fontWeight: "600" }}>Status Trigger</th>
                </tr>
              </thead>
              <tbody>
                {deadStockProducts.map((product) => (
                  <tr key={product.id} style={{ borderBottom: "1px solid #f1f2f4", color: "#202123" }}>
                    <td style={{ padding: "12px", fontWeight: "600" }}>{product.title}</td>
                    <td style={{ padding: "12px", color: "#b02a37", fontWeight: "700" }}>{product.qty} units left</td>
                    <td style={{ padding: "12px" }}>{product.price}</td>
                    <td style={{ padding: "12px" }}>
                      <span style={{ padding: "4px 8px", background: "#fff0f0", color: "#b02a37", borderRadius: "4px", fontSize: "12px", fontWeight: "500" }}>
                        0 Sales in {currentDaysApplied} Days
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