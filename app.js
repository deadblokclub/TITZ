/********************
 * TITZ Mint dApp — UI Refresh
 * - Keeps your contract logic intact
 * - Adds infinite scrolling IPFS gallery (lazy loads all images)
 * - Cleaner status tiles, progress bar, and wallet UX
 ********************/

// ====== EDIT THESE ======
const CONTRACT_ADDRESS = "0xc9df3da7f53a145b88b88925d380d6071f8d25c3";  // your deployed TITZ
const WALLETCONNECT_PROJECT_ID = ""; // optional; add one to enable WalletConnect button

// Images CDN (your IPFS images root, numbered 1.png ... N.png)
const IMAGES_BASE = "https://bafybeib4tdoeyajesmm4mz5ykqhilt7s6g3cl2dsixwjwqds2dvbdjmejy.ipfs.w3s.link";
const IMAGES_EXT = "png";
const MAX_IMAGES = 7175;          // total supply
const BATCH_SIZE = 60;            // how many tiles per scroll batch

// ====== On-chain / ABI ======
const ABI = [
  "function mint(uint256 quantity) payable",
  "function saleActive() view returns (bool)",
  "function totalMinted() view returns (uint256)",
  "function remaining() view returns (uint256)",
  "function price() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Minted(address indexed to, uint256 indexed tokenId)"
];

const BASE = {
  chainIdHex: "0x2105", // 8453
  chainIdDec: 8453,
  name: "Base",
  rpcUrls: ["https://mainnet.base.org"],
  explorer: "https://basescan.org",
  currency: { name: "ETH", symbol: "ETH", decimals: 18 }
};

// ====== helpers ======
const $ = (id) => document.getElementById(id);
const log = (t) => { const el = $("log"); el.textContent += "\n" + t; el.scrollTop = el.scrollHeight; };
const fmt = (wei) => ethers.utils.formatEther(wei);
const toHttp = (uri) => uri && uri.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + uri.slice(7) : uri;

// fallback IPFS fetch (ipfs.io → cloudflare)
async function fetchJsonWithFallback(uri){
  const a = toHttp(uri);
  try { return await (await fetch(a)).json(); }
  catch {
    const b = a.replace("https://ipfs.io/ipfs/","https://cloudflare-ipfs.com/ipfs/");
    return await (await fetch(b)).json();
  }
}

// state
let provider, signer, contract, priceWei;
let injectedChosen = null;     // the selected injected provider (EIP-6963 or fallback)
let wcProvider = null;         // walletconnect instance
const discovered = [];         // EIP-6963 providers announced

// EIP-6963 discovery
window.addEventListener("eip6963:announceProvider", (ev) => {
  discovered.push(ev.detail);
  buildWalletList();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

// Build wallet selection modal list
function buildWalletList(){
  const list = $("walletList");
  list.innerHTML = "";

  // Add discovered injected wallets
  for (const p of discovered){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="${p.info.icon||''}" alt=""><span>${p.info.name||'Wallet'}</span>`;
    btn.onclick = async () => {
      injectedChosen = p.provider;
      closeModal();
      await connectInjected();
    };
    list.appendChild(btn);
  }

  // Generic fallback for window.ethereum (covers MetaMask-like)
  if (!discovered.length && window.ethereum){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="" alt=""><span>Browser Wallet (Injected)</span>`;
    btn.onclick = async () => { injectedChosen = window.ethereum; closeModal(); await connectInjected(); };
    list.appendChild(btn);
  }

  // Phantom explicit fallback (some versions expose window.phantom.ethereum)
  if (window.phantom && window.phantom.ethereum){
    const btn = document.createElement("div");
    btn.className = "wbtn";
    btn.innerHTML = `<img src="" alt=""><span>Phantom (Injected)</span>`;
    btn.onclick = async () => { injectedChosen = window.phantom.ethereum; closeModal(); await connectInjected(); };
    list.appendChild(btn);
  }

  // WalletConnect option (only if project id provided)
  const wcBtn = document.createElement("div");
  wcBtn.className = "wbtn" + (WALLETCONNECT_PROJECT_ID ? "" : " disabled");
  wcBtn.innerHTML = `<img src="https://raw.githubusercontent.com/WalletConnect/walletconnect-monorepo/master/packages/icons/svg/walletconnect-logo.svg" alt=""><span>WalletConnect (QR)</span>`;
  wcBtn.onclick = async () => {
    if (!WALLETCONNECT_PROJECT_ID) return;
    closeModal();
    await connectWC();
  };
  list.appendChild(wcBtn);
}

function openModal(){ $("walletModal").style.display = "flex"; }
function closeModal(){ $("walletModal").style.display = "none"; }

// ====== Base network guard ======
async function ensureBase(eth){
  const cid = await eth.request({ method:"eth_chainId" });
  if (cid !== BASE.chainIdHex){
    try {
      await eth.request({ method:"wallet_switchEthereumChain", params:[{ chainId: BASE.chainIdHex }] });
    } catch(e){
      if (e.code === 4902){
        await eth.request({ method:"wallet_addEthereumChain", params:[{
          chainId: BASE.chainIdHex, chainName: BASE.name,
          rpcUrls: BASE.rpcUrls, blockExplorerUrls: [BASE.explorer],
          nativeCurrency: BASE.currency
        }]});
      } else { throw e; }
    }
  }
  $("network").textContent = "Network: Base";
  $("network").className = "pill good";
  $("basescan").href = `${BASE.explorer}/address/${CONTRACT_ADDRESS}`;
}

// ====== Contract init ======
async function initContract(eth){
  provider = new ethers.providers.Web3Provider(eth);
  signer = provider.getSigner();
  contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);

  const addr = await signer.getAddress();
  $("addr").textContent = addr.slice(0,6) + "…" + addr.slice(-4);
  $("mint").disabled = false;

  priceWei = await contract.price();
  $("price").textContent = fmt(priceWei);
  log("Connected: " + addr + "  price " + fmt(priceWei) + " ETH");

  await syncSupply();

  eth.on?.("accountsChanged", ()=>location.reload());
  eth.on?.("chainChanged",   ()=>location.reload());
}

// ====== Connectors ======
async function connectInjected(){
  try{
    const eth = injectedChosen || window.ethereum || (window.phantom && window.phantom.ethereum);
    if (!eth){ alert("No injected wallet found. Install MetaMask / Phantom / Coinbase / Rabby."); return; }
    await eth.request({ method:"eth_requestAccounts" });
    await ensureBase(eth);
    await initContract(eth);
  }catch(e){ log("❌ " + e.message); }
}

async function connectWC(){
  try{
    const WC = window.WalletConnectEthereumProvider;
    if (!WC){ alert("WalletConnect library not loaded."); return; }
    wcProvider = await WC.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      chains: [BASE.chainIdDec],
      optionalChains: [BASE.chainIdDec],
      showQrModal: true,
      rpcMap: { [BASE.chainIdDec]: BASE.rpcUrls[0] }
    });
    await wcProvider.enable();
    await initContract(wcProvider);
    wcProvider.on("session_delete", ()=>location.reload());
  }catch(e){ log("❌ " + e.message); }
}

function disconnect(){
  try{ wcProvider?.disconnect().catch(()=>{}); }catch{}
  location.reload();
}

// ====== UI sync ======
async function syncSupply(){
  if (!contract){
    // read-only via RPC when not connected
    try{
      const rp = new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0]);
      const read = new ethers.Contract(CONTRACT_ADDRESS, ABI, rp);
      const pr = await read.price();  priceWei = pr;
      $("price").textContent = fmt(pr);
      const minted = await read.totalMinted();
      const left   = await read.remaining();
      paintSupply(minted, left);
      const active = await read.saleActive();
      paintSale(active);
    }catch{}
    return;
  }

  try{
    const minted = await contract.totalMinted();
    const left   = await contract.remaining();
    paintSupply(minted, left);

    const active = await contract.saleActive();
    paintSale(active);
  }catch(e){
    // ignore here
  }
}

function paintSupply(minted, left){
  $("minted").textContent = minted.toString();
  $("remaining").textContent = left.toString();
  const total = minted.add(left).toNumber();
  const pct = total>0 ? Math.round(minted.toNumber()*100/total) : 0;
  $("bar").style.width = pct + "%";
}
function paintSale(active){
  $("sale").textContent = "Sale: " + (active ? "Active" : "Paused");
  $("sale").className = "pill " + (active ? "good" : "bad");
}

// ====== Mint ======
async function doMint(){
  try{
    if (!signer){ log("Connect a wallet first."); return; }
    const qty = Math.max(1, parseInt($("qty").value || "1", 10));

    const active = await contract.saleActive();
    if (!active){ log("❌ Sale is not active."); return; }

    const value = priceWei.mul(qty);
    log(`Minting ${qty} for ${fmt(value)} ETH…`);
    const tx = await contract.mint(qty, { value });
    log("Tx sent: " + tx.hash);
    const rcpt = await tx.wait();
    log("✅ Confirmed in block " + rcpt.blockNumber);
    await syncSupply();

    // Find your tokenIds in this tx
    const iface = new ethers.utils.Interface(ABI);
    const me = (await signer.getAddress()).toLowerCase();
    const mine = rcpt.logs
      .filter(l => l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase())
      .map(l => { try { return iface.parseLog(l); } catch { return null; } })
      .filter(x => x && x.name === "Minted" && x.args.to.toLowerCase() === me)
      .map(x => x.args.tokenId.toNumber());

    if (mine.length){
      const lastId = mine[mine.length-1];
      $("last").textContent = `Last minted: #${lastId}`;
      try{
        const uri = await contract.tokenURI(lastId);
        $("meta").textContent = uri;
        const meta = await fetchJsonWithFallback(uri);
        const img = toHttp(meta.image || meta.image_url);
        $("imgbox").innerHTML = img ? `<img src="${img}" alt="NFT">` : "no image in metadata";
      }catch{ $("meta").textContent = "metadata fetch failed"; }
    }
  }catch(e){ log("❌ " + (e && e.message ? e.message : e)); }
}

// ====== Preview by ID ======
async function preview(){
  try{
    const id = parseInt($("previewId").value);
    if (!id){ return; }
    try{
      const metaUri = await (provider ? new ethers.Contract(CONTRACT_ADDRESS, ABI, provider).tokenURI(id) :
                                   new ethers.Contract(CONTRACT_ADDRESS, ABI, new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0])).tokenURI(id));
      const meta = await fetchJsonWithFallback(metaUri);
      const img = toHttp(meta.image || meta.image_url);
      $("imgbox").innerHTML = img ? `<img src="${img}" alt="NFT">` : "no image";
      $("meta").textContent = metaUri;
      return;
    }catch{
      // not minted yet: fall back to raw images/metadata on IPFS by ID
      const direct = `ipfs://bafybeiewgci5uau4t7fgvzhwkydozmtqxygrbev2syqwndnphit6dk24dy/${id}.json`;
      const meta = await fetchJsonWithFallback(direct);
      const img = toHttp(meta.image || meta.image_url);
      $("imgbox").innerHTML = img ? `<img src="${img}" alt="NFT">` : "no image";
      $("meta").textContent = direct;
    }
  }catch(e){ log("❌ preview: " + e.message); }
}

// ====== Recent mints ======
async function loadRecent(){
  try{
    const rp = provider || new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0]);
    const c  = new ethers.Contract(CONTRACT_ADDRESS, ABI, rp);
    const latest = await rp.getBlockNumber();
    const from   = Math.max(0, latest - 120000);
    const ev = await c.queryFilter(c.filters.Minted(), from, latest);
    const last = ev.slice(-10).reverse();
    if (!last.length){ $("recent").textContent = "No mint events found."; return; }
    $("recent").innerHTML = last.map(e=>{
      const id = e.args.tokenId.toNumber();
      const addr = e.args.to;
      return `• <b>#${id}</b> → <code>${addr.slice(0,6)}…${addr.slice(-4)}</code> — <a href="${BASE.explorer}/tx/${e.transactionHash}" target="_blank">tx</a>`;
    }).join("<br>");
  }catch(e){ $("recent").textContent = "Load failed: " + e.message; }
}
function clearRecent(){ $("recent").textContent = "No events loaded yet."; }

// ====== IPFS Gallery (infinite grid) ======
let nextIndex = 1;
let observer;

function makeTile(idx){
  const url = `${IMAGES_BASE}/${idx}.${IMAGES_EXT}`;
  const tile = document.createElement("div");
  tile.className = "tile2";
  tile.innerHTML = `
    <img loading="lazy" decoding="async" alt="TITZ #${idx}" src="${url}">
    <div class="cap">#${idx}</div>
  `;
  // if an image is missing, hide the tile
  const img = tile.querySelector("img");
  img.onerror = () => { tile.style.display = "none"; };
  // click: quick preview in the right panel
  tile.onclick = () => {
    $("previewId").value = idx;
    preview().catch(()=>{});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return tile;
}

function loadBatch(){
  const grid = $("galleryGrid");
  let added = 0;
  while (added < BATCH_SIZE && nextIndex <= MAX_IMAGES){
    grid.appendChild( makeTile(nextIndex) );
    nextIndex++;
    added++;
  }
  if (nextIndex > MAX_IMAGES){
    $("galleryHint").textContent = "End of collection.";
    observer && observer.disconnect();
  } else {
    $("galleryHint").textContent = "Loading…";
  }
}

function setupInfiniteScroll(){
  const sent = $("sentinel");
  observer = new IntersectionObserver((entries)=>{
    for (const entry of entries){
      if (entry.isIntersecting){
        loadBatch();
      }
    }
  }, { rootMargin: "500px" });
  observer.observe(sent);
}

// ====== bootstrap (read-only price/supply + gallery) ======
(async function bootstrap(){
  try{
    const rp = new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0]);
    const read = new ethers.Contract(CONTRACT_ADDRESS, ABI, rp);
    const pr = await read.price();  priceWei = pr;
    $("price").textContent = fmt(pr);
    const minted = await read.totalMinted();
    const left   = await read.remaining();
    paintSupply(minted, left);
    const active = await read.saleActive();
    paintSale(active);
  }catch{}

  // Setup Basescan link
  $("basescan").href = `${BASE.explorer}/address/${CONTRACT_ADDRESS}`;

  // Gallery
  setupInfiniteScroll();
  loadBatch();
})();

// ====== wire up ======
$("openConnect").onclick = () => { buildWalletList(); openModal(); };
$("closeModal").onclick  = closeModal;
$("disconnect").onclick  = disconnect;
$("mint").onclick        = doMint;
$("loadRecent").onclick  = loadRecent;
$("clearRecent").onclick = clearRecent;
$("previewBtn").onclick  = preview;
