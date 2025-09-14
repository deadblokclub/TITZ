import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { EthereumProvider } from '@walletconnect/ethereum-provider';
import './App.css';

// ====== CONTRACT CONFIG ======
const CONTRACT_ADDRESS = "0xc9df3da7f53a145b88b88925d380d6071f8d25c3";
const WALLETCONNECT_PROJECT_ID = ""; // Add your WalletConnect project ID here

const RPCS = [
  "https://base-mainnet.g.alchemy.com/v2/gx1FJPkbagtcOFiznk_FI",
  "https://mainnet.base.org"
];

const IMAGES_BASE = "https://bafybeib4tdoeyajesmm4mz5ykqhilt7s6g3cl2dsixwjwqds2dvbdjmejy.ipfs.w3s.link";
const IMAGES_EXT = "png";
const MAX_IMAGES = 7175;
const BATCH_SIZE = 60;

const ABI = [
  "function mint(uint256 quantity) payable",
  "function claim(uint256 quantity) payable",
  "function saleActive() view returns (bool)",
  "function totalMinted() view returns (uint256)",
  "function remaining() view returns (uint256)",
  "function price() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const BASE = {
  chainIdHex: "0x2105",
  chainIdDec: 8453,
  name: "Base",
  rpcUrls: RPCS,
  explorer: "https://basescan.org",
  currency: { name: "ETH", symbol: "ETH", decimals: 18 }
};

function App() {
  // State management
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [priceWei, setPriceWei] = useState(null);
  const [address, setAddress] = useState(null);
  const [network, setNetwork] = useState("—");
  const [saleStatus, setSaleStatus] = useState("—");
  const [minted, setMinted] = useState("0");
  const [remaining, setRemaining] = useState("0");
  const [quantity, setQuantity] = useState(1);
  const [log, setLog] = useState("Ready.");
  const [recentMints, setRecentMints] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [wcProvider, setWcProvider] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // Gallery state
  const [galleryImages, setGalleryImages] = useState([]);
  const [nextIndex, setNextIndex] = useState(1);
  const galleryViewportRef = useRef(null);
  const sentinelRef = useRef(null);

  // Helper functions
  const addLog = (text) => {
    setLog(prev => prev + "\n" + text);
  };

  const formatEther = (wei) => {
    try {
      return ethers.utils.formatEther(wei);
    } catch {
      return "0";
    }
  };

  // EIP-6963 wallet discovery
  useEffect(() => {
    const handleAnnounce = (event) => {
      setDiscovered(prev => [...prev, event.detail]);
    };

    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => {
      window.removeEventListener("eip6963:announceProvider", handleAnnounce);
    };
  }, []);

  // Ensure Base network
  const ensureBase = async (ethereum) => {
    const chainId = await ethereum.request({ method: "eth_chainId" });
    if (chainId !== BASE.chainIdHex) {
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE.chainIdHex }]
        });
      } catch (error) {
        if (error.code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: BASE.chainIdHex,
              chainName: BASE.name,
              rpcUrls: BASE.rpcUrls,
              blockExplorerUrls: [BASE.explorer],
              nativeCurrency: BASE.currency
            }]
          });
        } else {
          throw error;
        }
      }
    }
    setNetwork("Base");
  };

  // Initialize contract
  const initContract = async (ethereum) => {
    const web3Provider = new ethers.providers.Web3Provider(ethereum);
    const web3Signer = web3Provider.getSigner();
    const contractInstance = new ethers.Contract(CONTRACT_ADDRESS, ABI, web3Signer);

    const addr = await web3Signer.getAddress();
    setAddress(addr);
    setProvider(web3Provider);
    setSigner(web3Signer);
    setContract(contractInstance);

    const price = await contractInstance.price();
    setPriceWei(price);
    
    addLog(`Connected: ${addr.slice(0, 6)}…${addr.slice(-4)} — price ${formatEther(price)} ETH`);

    // Listen for account/chain changes
    if (ethereum.on) {
      ethereum.on("accountsChanged", () => window.location.reload());
      ethereum.on("chainChanged", () => window.location.reload());
    }
  };

  // Connect with injected wallet
  const connectInjected = async (injectedProvider) => {
    try {
      setLoading(true);
      const ethereum = injectedProvider || window.ethereum || (window.phantom?.ethereum);
      if (!ethereum) {
        alert("No wallet found. Please install MetaMask, Phantom, or another Web3 wallet.");
        return;
      }
      
      await ethereum.request({ method: "eth_requestAccounts" });
      await ensureBase(ethereum);
      await initContract(ethereum);
      setShowModal(false);
    } catch (error) {
      addLog("❌ " + (error.message || "Connection failed"));
    } finally {
      setLoading(false);
    }
  };

  // Connect with WalletConnect
  const connectWalletConnect = async () => {
    if (!WALLETCONNECT_PROJECT_ID) {
      alert("WalletConnect project ID not configured");
      return;
    }

    try {
      setLoading(true);
      const wcProviderInstance = await EthereumProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: [BASE.chainIdDec],
        optionalChains: [BASE.chainIdDec],
        showQrModal: true,
        rpcMap: { [BASE.chainIdDec]: BASE.rpcUrls[0] }
      });

      await wcProviderInstance.enable();
      setWcProvider(wcProviderInstance);
      await initContract(wcProviderInstance);
      setShowModal(false);

      wcProviderInstance.on("session_delete", () => window.location.reload());
    } catch (error) {
      addLog("❌ " + (error.message || "WalletConnect failed"));
    } finally {
      setLoading(false);
    }
  };

  // Disconnect wallet
  const disconnect = () => {
    if (wcProvider) {
      wcProvider.disconnect().catch(() => {});
    }
    window.location.reload();
  };

  // Sync supply data
  const syncSupply = useCallback(async () => {
    try {
      const rpcProvider = provider || new ethers.providers.JsonRpcProvider(BASE.rpcUrls[0]);
      const readContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, rpcProvider);

      // Get price if not set
      if (!priceWei) {
        try {
          const price = await readContract.price();
          setPriceWei(price);
        } catch {}
      }

      // Get supply stats
      const [mintedAmount, remainingAmount, isActive] = await Promise.all([
        readContract.totalMinted(),
        readContract.remaining(),
        readContract.saleActive().catch(() => false)
      ]);

      setMinted(mintedAmount.toString());
      setRemaining(remainingAmount.toString());
      setSaleStatus(isActive ? "Active" : "Paused");
    } catch (error) {
      console.warn("syncSupply error:", error);
    }
  }, [provider, priceWei]);

  // Load recent mints
  const loadRecentMints = useCallback(async (count = 5) => {
    try {
      const url = RPCS[0];
      const body = {
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [{
          fromBlock: "0x0",
          toBlock: "latest",
          category: ["erc721"],
          contractAddresses: [CONTRACT_ADDRESS],
          order: "desc",
          withMetadata: false
        }]
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();

      const transfers = (data.result?.transfers || []).filter(
        t => t.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
      );

      const mints = transfers.slice(0, count).map(ev => ({
        id: parseInt(ev.tokenId, 16),
        to: ev.to,
        hash: ev.hash
      }));

      setRecentMints(mints);
    } catch (error) {
      console.warn("loadRecentMints error:", error);
      setRecentMints([]);
    }
  }, []);

  // Mint NFTs
  const doMint = async () => {
    if (!signer || !contract) {
      addLog("Connect a wallet first.");
      return;
    }

    try {
      setLoading(true);
      const qty = Math.max(1, parseInt(quantity, 10));

      const isActive = await contract.saleActive().catch(() => false);
      if (!isActive) {
        addLog("❌ Sale is not active.");
        return;
      }

      const value = priceWei.mul(qty);
      addLog(`Minting ${qty} for ${formatEther(value)} ETH…`);

      let tx;
      
      // Try mint function first, then claim if that fails
      try {
        await contract.estimateGas.mint(qty, { value });
        tx = await contract.mint(qty, { value, gasLimit: 250000 });
      } catch {
        try {
          await contract.estimateGas.claim(qty, { value });
          tx = await contract.claim(qty, { value, gasLimit: 250000 });
        } catch (error) {
          const msg = error?.error?.message || error?.data?.message || error?.message || "Transaction failed";
          throw new Error(msg);
        }
      }

      addLog("Tx sent: " + tx.hash);
      const receipt = await tx.wait();
      addLog("✅ Confirmed in block " + receipt.blockNumber);

      await syncSupply();
      await loadRecentMints(5);
    } catch (error) {
      const msg = error?.error?.message || error?.data?.message || error?.message || String(error);
      addLog("❌ " + msg);
    } finally {
      setLoading(false);
    }
  };

  // Load gallery batch
  const loadGalleryBatch = useCallback(() => {
    const newImages = [];
    let added = 0;
    let currentIndex = nextIndex;

    while (added < BATCH_SIZE && currentIndex <= MAX_IMAGES) {
      newImages.push({
        id: currentIndex,
        url: `${IMAGES_BASE}/${currentIndex}.${IMAGES_EXT}`
      });
      currentIndex++;
      added++;
    }

    setGalleryImages(prev => [...prev, ...newImages]);
    setNextIndex(currentIndex);
  }, [nextIndex]);

  // Setup infinite scroll for gallery
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            loadGalleryBatch();
          }
        });
      },
      {
        root: galleryViewportRef.current,
        rootMargin: "400px"
      }
    );

    if (sentinelRef.current) {
      observer.observe(sentinelRef.current);
    }

    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
      }
    };
  }, [loadGalleryBatch]);

  // Initial data load
  useEffect(() => {
    syncSupply();
    loadRecentMints(5);
    loadGalleryBatch();
  }, []);

  // Auto-refresh supply every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      syncSupply();
    }, 30000);

    return () => clearInterval(interval);
  }, [syncSupply]);

  return (
    <div className="app">
      <div className="wrap">
        {/* TOP BANNERS */}
        <header className="banners">
          <div className="banner banner-left" aria-label="TITZ banner" />
          <div className="banner banner-right" aria-label="OpenSea banner" />
        </header>

        {/* MAIN PANEL */}
        <section className="panel">
          <div className="grid">
            {/* LEFT SIDE */}
            <div>
<p className="muted" style={{margin:'2px 0 0', fontSize:'23px'}}>
TITZ is a cheeky PFP collection that doesn't take itself too seriously. 7,175 characters stitched from bold colours, weird assets, and a sense of humour that's a bit naughty.
</p>

              <div className="row pills-row">
                <span className="pill" id="network">Network: {network}</span>
                <span className="pill" id="sale">Sale: {saleStatus}</span>
                <span className="pill" id="pricePill">
                  Price: <b style={{ marginLeft: '6px' }}>
                    {priceWei ? formatEther(priceWei) : "—"}
                  </b> ETH
                </span>
                <span className="pill" id="contractPill">
                  Contract <a 
                    href={`${BASE.explorer}/address/${CONTRACT_ADDRESS}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ marginLeft: '6px' }}
                  >
                    view
                  </a>
                </span>
              </div>

              <div className="stats">
                <div className="tile">
                  <div className="muted">Minted</div>
                  <b>{minted}</b>
                </div>
                <div className="tile">
                  <div className="muted">Remaining</div>
                  <b>{remaining}</b>
                </div>
                <div className="tile">
                  <div className="muted">Your Address</div>
                  <b>{address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected"}</b>
                </div>
              </div>

              <div className="recent">
                <div className="title">Recent Mints</div>
                <div className="muted recent-list">
                  {recentMints.length === 0 ? (
                    "Loading…"
                  ) : (
                    recentMints.map((mint, i) => (
                      <div key={i} className="item">
                        • <b>#{mint.id}</b> → <code>{mint.to.slice(0, 6)}…{mint.to.slice(-4)}</code> —{" "}
                        <a 
                          href={`${BASE.explorer}/tx/${mint.hash}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          tx
                        </a>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT SIDE: CLAIM */}
            <div>
<h3 
  className="title" 
  style={{ 
    fontSize: '33px', 
    borderBottom: '10px solid #f71bb9', 
    lineHeight: '1.1', 
    display: 'inline-block', 
    paddingBottom: '0' 
  }}
>
  CLAIM A RANDOM TITZ NFT!
</h3>




              <div className="row button-row">
                {!address ? (
                  <button 
                    className="imgbtn wallet" 
                    onClick={() => setShowModal(true)}
                    disabled={loading}
                  >
                    {loading ? "Connecting..." : "Connect Wallet"}
                  </button>
                ) : (
                  <button 
                    className="imgbtn wallet" 
                    onClick={disconnect}
                  >
                    Disconnect
                  </button>
                )}
              </div>

              <div className="row mint-row">
                <input 
                  className="qty" 
                  type="number" 
                  min="1" 
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <button 
                  className="imgbtn" 
                  onClick={doMint}
                  disabled={!address || loading}
                >
                  {loading ? "Processing..." : "Claim"}
                </button>
              </div>

              <div className="log">{log}</div>

              {/* Social icons */}
              <div className="socials">
                <a href="https://x.com/titznft" target="_blank" rel="noopener noreferrer">
                  <img src="/assets/x-icon.png" alt="X" />
                </a>
                <a href="https://t.me/titznft" target="_blank" rel="noopener noreferrer">
                  <img src="/assets/telegram-icon.png" alt="Telegram" />
                </a>
                <a href="https://opensea.io/collection/titz-274086807" target="_blank" rel="noopener noreferrer">
                  <img src="/assets/opensea-icon.png" alt="OpenSea" />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* GALLERY PANEL */}
        <section className="gallery-panel">
<div 
  className="title" 
  style={{ 
    marginBottom: '8px',
    fontSize: '55px',
    borderBottom: '10px solid #f71bb9',
    lineHeight: '1.1',
    display: 'inline-block',
    paddingBottom: '0'
  }}
>
  Explore the Collection
</div>
          <div className="galleryViewport" ref={galleryViewportRef}>
            <div className="grid2">
              {galleryImages.map((img) => (
                <div key={img.id} className="tile2">
                  <img 
                    loading="lazy" 
                    decoding="async" 
                    alt={`TITZ #${img.id}`} 
                    src={img.url}
                    onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                  />
                  <div className="cap">#{img.id}</div>
                </div>
              ))}
            </div>
            <div ref={sentinelRef} style={{ height: '1px' }} />
          </div>
        </section>
      </div>

      {/* WALLET MODAL */}
      {showModal && (
        <div className="modal">
          <div className="sheet">
            <div className="modal-header">
              <h3>Connect Wallet</h3>
              <span className="closex" onClick={() => setShowModal(false)}>✕</span>
            </div>
            <p className="muted">Choose your wallet to connect</p>
            <div className="wallets">
              {discovered.map((provider, i) => (
                <div 
                  key={i} 
                  className="wbtn" 
                  onClick={() => connectInjected(provider.provider)}
                >
                  <img src={provider.info.icon || ''} alt="" />
                  <span>{provider.info.name || 'Wallet'}</span>
                </div>
              ))}
              
              {discovered.length === 0 && window.ethereum && (
                <div className="wbtn" onClick={() => connectInjected(window.ethereum)}>
                  <img src="" alt="" />
                  <span>Browser Wallet</span>
                </div>
              )}

              {window.phantom?.ethereum && (
                <div className="wbtn" onClick={() => connectInjected(window.phantom.ethereum)}>
                  <img src="" alt="" />
                  <span>Phantom</span>
                </div>
              )}

              <div 
                className={`wbtn ${!WALLETCONNECT_PROJECT_ID ? 'disabled' : ''}`} 
                onClick={connectWalletConnect}
              >
                <img 
                  src="https://raw.githubusercontent.com/WalletConnect/walletconnect-monorepo/master/packages/icons/svg/walletconnect-logo.svg" 
                  alt="" 
                />
                <span>WalletConnect (QR)</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;