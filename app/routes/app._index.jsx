import { useLoaderData, useRevalidator } from "react-router"; // 1. Import useRevalidator
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Calculate the date for 7 days ago in ISO format
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  // 2. Fetch products (with variants and inventory cost metrics) and recent orders
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

  // 3. Extract IDs of all products that HAVE been ordered in the last 7 days
  const orderedProductIds = new Set();
  recentOrders.forEach(({ node: order }) => {
    order.lineItems?.edges?.forEach(({ node: item }) => {
      if (item.product?.id) {
        orderedProductIds.add(item.product.id);
      }
    });
  });

  // 4. Core Calculations for Summary Metrics Box Row & Table Items list
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
        // Save the first available price to represent the product price row
        if (!samplePrice && variant.price) {
          samplePrice = parseFloat(variant.price);
        }
      });

      // Add to running metrics total cash tied up
      inventoryValue += productCapitalTiedValue;

      // Only add to table if the product actually has positive stock sitting in storage
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

  // Sort descending by highest capital tied up value
  tableItemsList.sort((a, b) => b.rawCapitalTied - a.rawCapitalTied);

  // Calculate estimated recovery based on your 28% model
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
  const revalidator = useRevalidator(); // 2. Initialize the revalidator

  const handleScanNow = () => {
    if (revalidator.state === "idle") {
      revalidator.revalidate(); // 3. This triggers the server side loader to run again
    }
  };

  return (
    <s-page>
      {/* HEADER SECTION WITH SCAN NOW BUTTON */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: "600", margin: 0, color: "#202123" }}>IdleStock Dashboard</h1>
          <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#6d7175" }}>
            Last scan: {new Date().toLocaleDateString()}
          </p>
        </div>
        <button 
          onClick={handleScanNow}
          disabled={revalidator.state === "loading"}
          style={{
            background: "#202123",
            color: "#fff",
            border: "none",
            padding: "8px 16px",
            borderRadius: "6px",
            fontWeight: "500",
            cursor: revalidator.state === "loading" ? "not-allowed" : "pointer",
            opacity: revalidator.state === "loading" ? 0.7 : 1,
            fontSize: "14px"
          }}
        >
          {revalidator.state === "loading" ? "Scanning..." : "Scan Now"}
        </button>
      </div>

      {/* SCAN CONFIRMATION BANNER */}
      <div style={{ 
        background: "#f1f8f5", 
        border: "1px solid #a3cfbb", 
        borderRadius: "8px", 
        padding: "12px 16px", 
        marginBottom: "24px",
        display: "flex",
        alignItems: "center",
        fontSize: "14px",
        color: "#146c43"
      }}>
        <span style={{ marginRight: "8px" }}>✓</span> 
        Scan completed. {metrics.totalProducts} products analyzed.
      </div>
      
      {/* METRICS OVERVIEW CARDS ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
          <s-stack direction="block" gap="tight">
            <s-text variant="subheadingSm" color="subdued">Total Products</s-text>
            <s-text variant="headingLg">{metrics.totalProducts}</s-text>
          </s-stack>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
          <s-stack direction="block" gap="tight">
            <s-text variant="subheadingSm" color="subdued">Dead Inventory</s-text>
            <s-text variant="headingLg" color="critical">{metrics.deadInventory}</s-text>
          </s-stack>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
          <s-stack direction="block" gap="tight">
            <s-text variant="subheadingSm" color="subdued">Inventory Value</s-text>
            <s-text variant="headingLg">{metrics.inventoryValue}</s-text>
          </s-stack>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="surface">
          <s-stack direction="block" gap="tight">
            <s-text variant="subheadingSm" color="subdued">Estimated Recovery</s-text>
            <s-text variant="headingLg" color="success">{metrics.estimatedRecovery}</s-text>
          </s-stack>
        </s-box>
      </div>

      {/* PRODUCTS COMPACTED DATA TABLE DISPLAY */}
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
                deadStockTableItems.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #e1e3e5", color: "#202123" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ fontWeight: "600", color: "#202123" }}>{item.productTitle}</div>
                    </td>
                    <td style={{ padding: "12px 16px" }}>{item.qty}</td>
                    <td style={{ padding: "12px 16px" }}>{item.daysUnsold}</td>
                    <td style={{ padding: "12px 16px" }}>{item.price}</td>
                    <td style={{ padding: "12px 16px", fontWeight: "600", color: "#b02a37" }}>{item.capitalTied}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ background: "#e2f1ff", color: "#0066cc", padding: "4px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: "600", display: "inline-block" }}>
                        Bundle
                      </span>
                    </td>
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