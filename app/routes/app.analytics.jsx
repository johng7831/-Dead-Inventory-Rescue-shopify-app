import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ==========================================
// 1. LOADER: Dynamically Aggregates Catalog & Aging Data
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

  let counts = { moving: 0, slowing: 0, stuck: 0, dead: 0, oversold: 0 };
  let values = { moving: 0, slowing: 0, stuck: 0, dead: 0, oversold: 0 };
  
  // Aging intervals distribution based on velocity
  let agingBins = { day30: 0, day60: 0, day90: 0, day120: 0, day180: 0 };

  allProducts.forEach(({ node: product }) => {
    const hasRecentSales = orderedProductIds.has(product.id);

    product.variants?.edges?.forEach(({ node: variant }) => {
      const qty = variant.inventoryQuantity || 0;
      const cost = parseFloat(variant.inventoryItem?.unitCost?.amount || variant.price || 0);
      const tiedCapital = Math.abs(qty * cost);

      if (qty < 0) {
        counts.oversold += 1;
        values.oversold += tiedCapital;
      } else if (hasRecentSales) {
        counts.moving += 1;
        values.moving += tiedCapital;
        agingBins.day30 += 1;
      } else {
        if (qty > 50) {
          counts.dead += 1;
          values.dead += tiedCapital;
          agingBins.day180 += 1;
        } else if (qty > 20) {
          counts.stuck += 1;
          values.stuck += tiedCapital;
          agingBins.day120 += 1;
          agingBins.day90 += 1; 
        } else {
          counts.slowing += 1;
          values.slowing += tiedCapital;
          agingBins.day60 += 1;
        }
      }
    });
  });

  const grandTotalItems = counts.moving + counts.slowing + counts.stuck + counts.dead + counts.oversold;
  const grandTotalValue = values.moving + values.slowing + values.stuck + values.dead + values.oversold;

  const formatUSD = (val) => val.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const getPct = (part) => (grandTotalItems > 0 ? Math.round((part / grandTotalItems) * 100) : 0);

  // Normalize aging chart graph lines limits dynamically based on highest count bin
  const maxBinValue = Math.max(...Object.values(agingBins), 10);
  const chartCeiling = Math.ceil(maxBinValue / 10) * 10; 

  return {
    runwayDays: 1533,
    problemCount: counts.dead + counts.stuck,
    deadCount: counts.dead,
    stuckCount: counts.stuck,
    atRiskAmount: formatUSD(values.dead + values.stuck),
    agingChart: {
      ceiling: chartCeiling,
      bins: [
        { label: "30", count: agingBins.day30 },
        { label: "60", count: agingBins.day60 },
        { label: "90", count: agingBins.day90 },
        { label: "120", count: agingBins.day120 },
        { label: "180", count: agingBins.day180 },
      ]
    },
    uiMetrics: {
      grandTotalItems,
      totalValFormatted: formatUSD(grandTotalValue),
      donutGradients: {
        movingPct: getPct(counts.moving),
        slowingPct: getPct(counts.slowing),
        stuckPct: getPct(counts.stuck),
        deadPct: getPct(counts.dead),
        oversoldPct: getPct(counts.oversold),
      },
      list: [
        { label: "Moving", count: counts.moving, pct: getPct(counts.moving), val: formatUSD(values.moving), color: "#10b981" },
        { label: "Slowing", count: counts.slowing, pct: getPct(counts.slowing), val: formatUSD(values.slowing), color: "#f59e0b" },
        { label: "Stuck", count: counts.stuck, pct: getPct(counts.stuck), val: formatUSD(values.stuck), color: "#ef4444" },
        { label: "Dead", count: counts.dead, pct: getPct(counts.dead), val: formatUSD(values.dead), color: "#1e1e24" },
        { label: "Oversold (owes)", count: counts.oversold, pct: getPct(counts.oversold), val: formatUSD(values.oversold), color: "#8b5cf6" }
      ]
    }
  };
};

// ==========================================
// 2. UI DASHBOARD WITH LIVE AGING PROFILE GRAPH
// ==========================================
export default function Index() {
  const data = useLoaderData();
  const { grandTotalItems, totalValFormatted, donutGradients, list } = data.uiMetrics;
  const { bins, ceiling } = data.agingChart;

  const p1 = donutGradients.movingPct;
  const p2 = p1 + donutGradients.slowingPct;
  const p3 = p2 + donutGradients.stuckPct;
  const p4 = p3 + donutGradients.deadPct;

  // Generate dynamic steps for graph Y-axis labels
  const yAxisTicks = Array.from({ length: 7 }, (_, i) => Math.round((ceiling / 6) * (6 - i)));

  return (
    <s-page style={{ position: "relative", fontFamily: "sans-serif", backgroundColor: "#f6f6f7", padding: "20px", display: "block" }}>
      
      {/* TOP SUMMARY KPIS BAR */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        <div style={{ background: "#fff", padding: "20px", borderRadius: "12px", border: "1px solid #e1e3e5" }}>
          <div style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>Avg Runway</div>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1a1c1d", marginTop: "6px" }}>{data.runwayDays} days</div>
        </div>
        <div style={{ background: "#fff", padding: "20px", borderRadius: "12px", border: "1px solid #e1e3e5" }}>
          <div style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>Problem</div>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1a1c1d", marginTop: "6px" }}>{data.problemCount} products</div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>• {data.deadCount} dead &nbsp; • {data.stuckCount} stuck</div>
        </div>
        <div style={{ background: "#fff", padding: "20px", borderRadius: "12px", border: "1px solid #e1e3e5" }}>
          <div style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>$ At Risk</div>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#1a1c1d", marginTop: "6px" }}>{data.atRiskAmount}</div>
          <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>Dead+Stuck inventory</div>
        </div>
        <div style={{ background: "#fff", padding: "20px", borderRadius: "12px", border: "1px solid #e1e3e5" }}>
          <div style={{ fontSize: "11px", color: "#6d7175", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>Auto-Discount</div>
          <div style={{ fontSize: "24px", fontWeight: "700", color: "#ef4444", marginTop: "6px" }}>INACTIVE</div>
          <div style={{ fontSize: "12px", color: "#0066cc", marginTop: "4px", cursor: "pointer", fontWeight: "500" }}>Enable →</div>
        </div>
      </div>

      {/* NEW SECTION: INVENTORY AGING PROFILE GRAPH CONTAINER */}
      <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", marginBottom: "24px" }}>
        <div style={{ marginBottom: "16px" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#1a1c1d", margin: "0" }}>Products Inventory Aging Breakdown</h3>
          <p style={{ fontSize: "13px", color: "#6d7175", margin: "4px 0 0 0" }}>Merchants immediately understand aging inventory velocity profiles.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "row", marginTop: "20px", position: "relative" }}>
          {/* Y Axis Grid Label Titles */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", paddingRight: "12px", alignItems: "flex-end", width: "40px", fontSize: "12px", color: "#6d7175", fontWeight: "500", height: "200px" }}>
            {yAxisTicks.map((tick, i) => (
              <span key={i}>{tick} ┤</span>
            ))}
          </div>

          {/* Graph Content Window Grid */}
          <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <div style={{ height: "200px", borderBottom: "2px solid #8c9196", display: "flex", alignItems: "flex-end", justifyContent: "space-around", padding: "0 20px", position: "relative" }}>
              
              {/* Subtle background horizontal guideline tracks */}
              <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ width: "100%", borderTop: "1px dashed #f1f2f4" }}></div>
                ))}
              </div>

              {/* Dynamic Mapping Bars */}
              {bins.map((bin, idx) => {
                const heightPercentage = Math.min((bin.count / ceiling) * 100, 100);
                return (
                  <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "45px", zIndex: 1 }}>
                    <span style={{ fontSize: "11px", fontWeight: "700", color: "#1a1c1d", marginBottom: "4px" }}>{bin.count}</span>
                    <div style={{
                      width: "100%",
                      height: `${heightPercentage}%`,
                      minHeight: bin.count > 0 ? "4px" : "0px",
                      backgroundColor: idx >= 3 ? "#ef4444" : idx === 2 ? "#f59e0b" : "#10b981",
                      borderRadius: "4px 4px 0 0",
                      transition: "height 0.4s ease"
                    }} />
                  </div>
                );
              })}
            </div>

            {/* X Axis Labels Footprint */}
            <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 20px 0 20px", fontSize: "12px", fontWeight: "600", color: "#4f545c" }}>
              {bins.map((bin, idx) => (
                <span key={idx} style={{ width: "45px", textAlign: "center" }}>{bin.label} Days</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* DETAILED INVENTORY HEALTH & VALUE STATUS SPLIT ROW */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", alignItems: "stretch" }}>
        
        {/* LEFT COLUMN: Inventory Health Ring Pie Layout */}
        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#1a1c1d", margin: "0 0 20px 0" }}>Inventory Health Status</h3>
          
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "20px 0" }}>
            <div style={{
              width: "140px",
              height: "140px",
              borderRadius: "50%",
              background: `conic-gradient(
                #10b981 0% ${p1}%, 
                #f59e0b ${p1}% ${p2}%, 
                #ef4444 ${p2}% ${p3}%, 
                #1e1e24 ${p3}% ${p4}%, 
                #8b5cf6 ${p4}% 100%
              )`,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0 2px 5px rgba(0,0,0,0.05)"
            }}>
              <div style={{
                width: "90px",
                height: "90px",
                borderRadius: "50%",
                backgroundColor: "#ffffff",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontWeight: "700",
                fontSize: "18px",
                color: "#1a1c1d"
              }}>
                {grandTotalItems}
              </div>
            </div>
          </div>

          {/* Legend Items */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "#4f545c", marginTop: "12px" }}>
            {list.map((m, idx) => (
              <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "10px", height: "10px", borderRadius: "50%", backgroundColor: m.color, display: "inline-block" }}></span>
                  <span>{m.label}: <strong>{m.count}</strong></span>
                </div>
                <span style={{ color: "#6d7175" }}>({m.pct}%)</span>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: Value Status Progress Rows */}
        <div style={{ background: "#fff", border: "1px solid #e1e3e5", borderRadius: "12px", padding: "24px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: "15px", fontWeight: "600", color: "#1a1c1d", margin: "0 0 20px 0" }}>Value Status</h3>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "18px", flexGrow: "1", justifyContent: "center" }}>
            {list.map((m, idx) => (
              <div key={idx} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: "500" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: m.color }}></span>
                    <span style={{ color: "#4f545c" }}>{m.label}</span>
                  </div>
                  <span style={{ fontWeight: "600", color: "#1a1c1d" }}>{m.val}</span>
                </div>
                <div style={{ width: "100%", height: "8px", backgroundColor: "#f1f2f4", borderRadius: "4px", overflow: "hidden" }}>
                  <div style={{ width: `${m.pct}%`, height: "100%", backgroundColor: m.color, borderRadius: "4px" }}></div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: "14px", marginTop: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "14px", fontWeight: "700", color: "#1a1c1d" }}>Total:</span>
            <span style={{ fontSize: "16px", fontWeight: "700", color: "#1a1c1d" }}>{totalValFormatted}</span>
          </div>
        </div>

      </div>

    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};