import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ReliefApplication {
  id: string;
  name: string;
  location: string;
  disasterType: string;
  encryptedVictims: string;
  publicSupplies: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<ReliefApplication[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingApplication, setCreatingApplication] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newApplicationData, setNewApplicationData] = useState({ 
    name: "", 
    location: "", 
    disasterType: "earthquake", 
    victims: "", 
    supplies: "" 
  });
  const [selectedApplication, setSelectedApplication] = useState<ReliefApplication | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, pending: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const applicationsList: ReliefApplication[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          applicationsList.push({
            id: businessId,
            name: businessData.name,
            location: businessId,
            disasterType: "disaster",
            encryptedVictims: businessId,
            publicSupplies: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setApplications(applicationsList);
      updateStats(applicationsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (apps: ReliefApplication[]) => {
    setStats({
      total: apps.length,
      verified: apps.filter(app => app.isVerified).length,
      pending: apps.filter(app => !app.isVerified).length
    });
  };

  const createApplication = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingApplication(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating relief application with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const victimsValue = parseInt(newApplicationData.victims) || 0;
      const businessId = `relief-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, victimsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newApplicationData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newApplicationData.supplies) || 0,
        0,
        `Location: ${newApplicationData.location}, Disaster: ${newApplicationData.disasterType}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Relief application created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewApplicationData({ name: "", location: "", disasterType: "earthquake", victims: "", supplies: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingApplication(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Victim count decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System availability check: " + (result ? "Available" : "Unavailable") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredApplications = applications.filter(app => 
    app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    app.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Disaster Relief 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🏥</div>
            <h2>Connect Wallet to Access Relief System</h2>
            <p>Connect your wallet to participate in privacy-preserving disaster relief distribution</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading relief applications...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🏥 FHE Disaster Relief</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="status-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Application
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Applications</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <div className="stat-value">{stats.verified}</div>
              <div className="stat-label">Verified</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">⏳</div>
            <div className="stat-content">
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search applications..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="applications-list">
          {filteredApplications.length === 0 ? (
            <div className="no-applications">
              <p>No relief applications found</p>
              <button onClick={() => setShowCreateModal(true)}>
                Create First Application
              </button>
            </div>
          ) : filteredApplications.map((application, index) => (
            <div 
              className={`application-item ${application.isVerified ? "verified" : "pending"}`} 
              key={index}
              onClick={() => setSelectedApplication(application)}
            >
              <div className="app-header">
                <div className="app-title">{application.name}</div>
                <div className="app-status">
                  {application.isVerified ? "✅ Verified" : "🔓 Pending"}
                </div>
              </div>
              <div className="app-details">
                <div className="detail-item">
                  <span>Supplies Needed:</span>
                  <strong>{application.publicSupplies}</strong>
                </div>
                <div className="detail-item">
                  <span>Created:</span>
                  <strong>{new Date(application.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
              </div>
              {application.isVerified && application.decryptedValue && (
                <div className="decrypted-info">
                  Victims: {application.decryptedValue} (FHE Decrypted)
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateApplication 
          onSubmit={createApplication} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingApplication} 
          applicationData={newApplicationData} 
          setApplicationData={setNewApplicationData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedApplication && (
        <ApplicationDetailModal 
          application={selectedApplication} 
          onClose={() => setSelectedApplication(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedApplication.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateApplication: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  applicationData: any;
  setApplicationData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, applicationData, setApplicationData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'victims') {
      const intValue = value.replace(/[^\d]/g, '');
      setApplicationData({ ...applicationData, [name]: intValue });
    } else {
      setApplicationData({ ...applicationData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-application-modal">
        <div className="modal-header">
          <h2>New Relief Application</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Privacy Features</strong>
            <p>Victim count will be encrypted using Zama FHE for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Organization Name *</label>
            <input 
              type="text" 
              name="name" 
              value={applicationData.name} 
              onChange={handleChange} 
              placeholder="Enter organization name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Location *</label>
            <input 
              type="text" 
              name="location" 
              value={applicationData.location} 
              onChange={handleChange} 
              placeholder="Enter disaster location..." 
            />
          </div>
          
          <div className="form-group">
            <label>Disaster Type</label>
            <select name="disasterType" value={applicationData.disasterType} onChange={handleChange}>
              <option value="earthquake">Earthquake</option>
              <option value="flood">Flood</option>
              <option value="hurricane">Hurricane</option>
              <option value="fire">Wildfire</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Number of Victims (FHE Encrypted) *</label>
            <input 
              type="number" 
              name="victims" 
              value={applicationData.victims} 
              onChange={handleChange} 
              placeholder="Enter victim count..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">🔐 FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Supplies Needed (Public) *</label>
            <input 
              type="number" 
              name="supplies" 
              value={applicationData.supplies} 
              onChange={handleChange} 
              placeholder="Enter supplies quantity..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !applicationData.name || !applicationData.location || !applicationData.victims || !applicationData.supplies} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ApplicationDetailModal: React.FC<{
  application: ReliefApplication;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ application, onClose, isDecrypting, decryptData }) => {
  const [localDecryptedValue, setLocalDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (application.isVerified) return;
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setLocalDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="application-detail-modal">
        <div className="modal-header">
          <h2>Relief Application Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="application-info">
            <div className="info-item">
              <span>Organization:</span>
              <strong>{application.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{application.creator.substring(0, 6)}...{application.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(application.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Supplies Needed:</span>
              <strong>{application.publicSupplies}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>FHE Encrypted Data</h3>
            
            <div className="data-row">
              <div className="data-label">Victim Count:</div>
              <div className="data-value">
                {application.isVerified && application.decryptedValue ? 
                  `${application.decryptedValue} (On-chain Verified)` : 
                  localDecryptedValue !== null ? 
                  `${localDecryptedValue} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(application.isVerified || localDecryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || application.isVerified}
              >
                {isDecrypting ? "Decrypting..." : application.isVerified ? "✅ Verified" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Privacy Protection</strong>
                <p>Victim count is encrypted on-chain using Zama FHE. Decryption preserves privacy while enabling relief allocation.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!application.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

