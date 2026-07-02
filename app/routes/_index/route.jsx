import { redirect, useLoaderData, Form } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function DeadInventoryApp() {
  const { showForm } = useLoaderData();

  // --- Theme & Styles matching the actual app (Dashboard / Discount / Analytics / Settings) ---
  const styles = {
    page: {
      minHeight: "100vh",
      backgroundColor: "#f1f2f4",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      padding: "2.5rem 1.5rem",
    },
    shell: {
      maxWidth: "960px",
      margin: "0 auto",
    },
    headerContainer: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "1.5rem",
      flexWrap: "wrap",
      gap: "1rem",
    },
    titleBlock: { display: "flex", flexDirection: "column" },
    title: {
      fontSize: "1.75rem",
      fontWeight: "700",
      color: "#2c6ecb",
      margin: 0,
    },
    subtitle: {
      margin: "4px 0 0 0",
      fontSize: "0.85rem",
      color: "#6d7175",
    },
    btnPrimary: {
      backgroundColor: "#2c6ecb",
      color: "#ffffff",
      border: "none",
      padding: "0.6rem 1.4rem",
      borderRadius: "8px",
      fontWeight: "600",
      cursor: "pointer",
      fontSize: "0.9rem",
    },
    bannerAlert: {
      backgroundColor: "#e3f1df",
      border: "1px solid #108043",
      borderRadius: "8px",
      padding: "1rem 1.25rem",
      color: "#108043",
      fontWeight: "500",
      marginBottom: "1.75rem",
      fontSize: "0.95rem",
    },
    gridCards: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      gap: "1.25rem",
      marginBottom: "1.75rem",
    },
    card: {
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      padding: "1.25rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      border: "1px solid #e1e3e5",
    },
    cardLabel: {
      fontSize: "0.72rem",
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      marginBottom: "0.5rem",
      display: "block",
    },
    cardValue: {
      fontSize: "1.6rem",
      fontWeight: "700",
      margin: 0,
    },
    sectionCard: {
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      padding: "1.75rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      border: "1px solid #e1e3e5",
      marginBottom: "1.75rem",
    },
    subheading: {
      fontSize: "1.1rem",
      color: "#202223",
      marginTop: 0,
      marginBottom: "1.25rem",
      fontWeight: "600",
    },
    list: {
      listStyle: "none",
      padding: 0,
      margin: 0,
      display: "flex",
      flexDirection: "column",
      gap: "1.25rem",
    },
    listItem: {
      display: "flex",
      gap: "1rem",
      alignItems: "flex-start",
      fontSize: "0.92rem",
      lineHeight: "1.5",
      color: "#4a4a4a",
    },
    featureIcon: { fontSize: "1.5rem", lineHeight: 1 },
    featureTitle: {
      display: "block",
      color: "#202223",
      fontWeight: "700",
      marginBottom: "0.2rem",
    },
    featureDesc: { margin: 0 },
    loginCard: {
      backgroundColor: "#ffffff",
      borderRadius: "8px",
      padding: "1.75rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      border: "1px solid #e1e3e5",
    },
    label: {
      display: "block",
      fontSize: "0.85rem",
      fontWeight: "600",
      color: "#202223",
      marginBottom: "0.4rem",
    },
    input: {
      width: "100%",
      padding: "0.6rem 0.75rem",
      borderRadius: "8px",
      border: "1px solid #c9cccf",
      fontSize: "0.95rem",
      marginBottom: "1rem",
      boxSizing: "border-box",
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        {/* Header */}
        <div style={styles.headerContainer}>
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>IdleStock Dashboard</h1>
            <p style={styles.subtitle}>Dead Inventory Rescue — Welcome Portal</p>
          </div>
          {!showForm && <button style={styles.btnPrimary}>Scan Now</button>}
        </div>

        {/* Status banner */}
        <div style={styles.bannerAlert}>
          ✓ Optimization engine ready — flag dead stock, track capital tied up, and launch
          liquidation campaigns in one click.
        </div>

        {/* Login form for shops that aren't installed yet */}
        {showForm && (
          <div style={{ ...styles.loginCard, marginBottom: "1.75rem" }}>
            <h2 style={styles.subheading}>Connect your store</h2>
            <Form method="post" action="/auth/login">
              <label style={styles.label} htmlFor="shop">
                Shop domain
              </label>
              <input
                style={styles.input}
                id="shop"
                name="shop"
                type="text"
                placeholder="my-store.myshopify.com"
              />
              <button style={styles.btnPrimary} type="submit">
                Log in
              </button>
            </Form>
          </div>
        )}

        {/* Metrics preview, mirrors the live Dashboard */}
        <div style={styles.gridCards}>
          <div style={{ ...styles.card, borderTop: "4px solid #2c6ecb" }}>
            <span style={{ ...styles.cardLabel, color: "#2c6ecb" }}>Total Products</span>
            <p style={{ ...styles.cardValue, color: "#202223" }}>Tracked live</p>
          </div>
          <div style={{ ...styles.card, borderTop: "4px solid #bf0711" }}>
            <span style={{ ...styles.cardLabel, color: "#bf0711" }}>Dead Inventory</span>
            <p style={{ ...styles.cardValue, color: "#bf0711" }}>Flagged automatically</p>
          </div>
          <div style={{ ...styles.card, borderTop: "4px solid #9c6ade" }}>
            <span style={{ ...styles.cardLabel, color: "#9c6ade" }}>Inventory Value</span>
            <p style={{ ...styles.cardValue, color: "#202223" }}>Real-time total</p>
          </div>
          <div style={{ ...styles.card, borderTop: "4px solid #008060" }}>
            <span style={{ ...styles.cardLabel, color: "#008060" }}>Estimated Recovery</span>
            <p style={{ ...styles.cardValue, color: "#008060" }}>Projected payout</p>
          </div>
        </div>

        {/* Feature section, tied to the real pages: Dashboard / Discount / Analytics / Settings */}
        <div style={styles.sectionCard}>
          <h2 style={styles.subheading}>What Dead Inventory Rescue does</h2>

          <ul style={styles.list}>
            <li style={styles.listItem}>
              <div style={styles.featureIcon}>📉</div>
              <div>
                <strong style={styles.featureTitle}>Dashboard — Automated Age Tracking</strong>
                <p style={styles.featureDesc}>
                  See every stagnant SKU at a glance — quantity, days unsold, retail price, and
                  capital tied up, all in one table.
                </p>
              </div>
            </li>

            <li style={styles.listItem}>
              <div style={styles.featureIcon}>🏷️</div>
              <div>
                <strong style={styles.featureTitle}>Discount — Campaign Manager</strong>
                <p style={styles.featureDesc}>
                  Apply a targeted discount to any dead-stock item straight from the list with a
                  single click.
                </p>
              </div>
            </li>

            <li style={styles.listItem}>
              <div style={styles.featureIcon}>📊</div>
              <div>
                <strong style={styles.featureTitle}>Analytics — Aging & Health Breakdown</strong>
                <p style={styles.featureDesc}>
                  Track runway, at-risk value, and an inventory aging curve across 30/60/90/180-day
                  windows, plus a live moving/slowing/stuck/dead health split.
                </p>
              </div>
            </li>

            <li style={styles.listItem}>
              <div style={styles.featureIcon}>⚙️</div>
              <div>
                <strong style={styles.featureTitle}>Settings — Dead Stock Finder</strong>
                <p style={styles.featureDesc}>
                  Choose your own stagnant window (7/30/60 days or a custom lookback) to isolate
                  products with zero sales in that period.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
