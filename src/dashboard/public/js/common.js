async function api(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...opts.headers } });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || "Error"); }
    return await r.json();
  } catch (err) { alert(err.message); throw err; }
}
function formatMoney(n) { return n.toLocaleString() + "원"; }
function toast(msg, type = "info") { const t = document.createElement("div"); t.className = "fixed bottom-4 right-4 px-6 py-3 rounded shadow-lg z-50 " + (type === "success" ? "bg-green-600" : type === "error" ? "bg-red-600" : "bg-gray-700"); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); }