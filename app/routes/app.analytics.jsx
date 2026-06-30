import { useLoaderData } from "react-router";
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
  let aggregateTotalCapital = 0;
  let aggregateTotalQty = 0;
  let maxCapitalTiedValue = 0;

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
        aggregateTotalCapital += productCapitalTiedValue;
        aggregateTotalQty += productTotalQty;
        
        if (productCapitalTiedValue > maxCapitalTiedValue) {
          maxCapitalTiedValue = productCapitalTiedValue;
        }

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

  return { 
    deadStockTableItems: tableItemsList,
    maxGraphValue: maxCapitalTiedValue || 1,
    analyticsSummary: {
      totalCapital: aggregateTotalCapital.toLocaleString("en-US", { style: "currency", currency: "USD" }),
      totalItems: aggregateTotalQty,
      productCount: tableItemsList.length
    }
  };
};

// ==========================================
// 2. UI DASHBOARD GRAPH
// ==========================================
export default function Index() {
  const { deadStockTableItems, analyticsSummary, maxGraphValue } = useLoaderData();

  return (
    <s-page style={{ position: "relative" }}>
      
      {/* BRAND HEADER & ANALYTICS BAR */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "20px", fontWeight: "700", color: "#1a1c1d", margin: "0 0 4px 0" }}>Dead Inventory Rescue</h1>
        <p style={{ color: "#6d7175", fontSize: "13px", margin: "0 0 16px 0" }}>Visual breakdown of capital allocations tied up in aging storefront stocks.</p>
        
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "12px", color: "#6d7175", fontWeight: "500", textTransform: "uppercase" }}>Tied Capital</div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "#b02a37", marginTop: "4px" }}>{analyticsSummary.totalCapital}</div>
          </div>
          <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "12px", color: "#6d7175", fontWeight: "500", textTransform: "uppercase" }}>Total Dead Stock Qty</div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "#202123", marginTop: "4px" }}>{analyticsSummary.totalItems} units</div>
          </div>
          <div style={{ background: "#fff", padding: "16px", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
            <div style={{ fontSize: "12px", color: "#6d7175", fontWeight: "500", textTransform: "uppercase" }}>Stagnant Products</div>
            <div style={{ fontSize: "22px", fontWeight: "700", color: "#0066cc", marginTop: "4px" }}>{analyticsSummary.productCount} Items</div>
          </div>
        </div>
      </div>

      {/* HORIZONTAL VALUE BAR GRAPH CHART SECTION */}
      <s-section heading="Capital Breakdown Graph">
        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "8px", padding: "24px", marginTop: "12px" }}>
          {deadStockTableItems.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#6d7175" }}>
              No stagnant inventory items detected.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {deadStockTableItems.map((item) => {
                const barWidthPercentage = (item.rawCapitalTied / maxGraphValue) * 100;

                return (
                  <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {/* Item Text Metrics Label */}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#202123" }}>
                      <span style={{ fontWeight: "600" }}>{item.productTitle} <span style={{ fontWeight: "400", color: "#6d7175" }}>({item.qty} units unsold)</span></span>
                      <span style={{ fontWeight: "700", color: "#b02a37" }}>{item.capitalTied} Tied</span>
                    </div>
                    
                    {/* Bar Graphic Container */}
                    <div style={{ 
                      width: "100%", 
                      background: "#f1f2f4", 
                      borderRadius: "6px", 
                      height: "24px", 
                      position: "relative",
                      overflow: "hidden",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)"
                    }}>
                      {/* Colored Active Value Layer Fill */}
                      <div style={{ 
                        width: `${Math.max(barWidthPercentage, 3)}%`, 
                        background: "linear-gradient(90deg, #007ac1, #0066cc)", 
                        height: "100%",
                        borderRadius: "6px",
                        transition: "width 0.4s ease-in-out"
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </s-section>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};