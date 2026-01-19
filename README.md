# <img src="packages/nextjs/public/logo.svg" alt="File Vault Logo" width="60" align="center" /> File Vault

A decentralized, end-to-end encrypted file sharing platform running on **Optimism Mainnet**. Users can upload files, transfer ownership on-chain, and securely share access with specific recipients while maintaining complete data privacy.

The architecture uses a **Hybrid Model**:
* **Identity & Ownership:** Optimism Mainnet (Upgradeable Smart Contracts)
* **Storage:** IPFS (Pinata) via Secure Server Proxy
* **Encryption Keys & Metadata:** Supabase (Postgres) with RLS
* **Encryption Engine:** Client-side AES-GCM + ECDH (No keys ever touch the server in plain text)

---

## 🚀 Key Features

* **Zero-Knowledge Encryption:** Files are encrypted in the browser before upload. The server only sees `.enc` blobs.
* **Secure IPFS Proxy:** Uploads are routed through a secure API proxy. IPFS credentials (`PINATA_JWT`) never leave the server, protecting your quota from abuse.
* **Resilient Mainnet Sync:** The backend employs robust retry logic and private Alchemy RPCs to handle blockchain latency and "race conditions" during high-traffic periods.
* **Upgradeable Smart Contracts:** Uses the OpenZeppelin Proxy pattern, allowing logic upgrades without breaking existing file records or ownership data.
* **On-Chain Ownership:** File ownership is tracked on an Ethereum smart contract. Only the on-chain owner can grant/revoke access.
* **Atomic Transfer & Key Handover:** Ownership transfer is atomic. The system automatically re-encrypts keys for the new owner and updates the blockchain registry in a single flow.

---

## 🛠️ Tech Stack

* **Frontend:** Next.js 14 (App Router), TailwindCSS, DaisyUI
* **Blockchain:** Hardhat, Viem, Wagmi (Optimism Mainnet)
* **Smart Contracts:** Solidity v0.8.20 (OpenZeppelin Upgradeable)
* **Storage:** Pinata (IPFS)
* **Database:** Supabase (PostgreSQL)
* **Cryptography:** Web Crypto API (AES-GCM-256, ECDH-P256)

---

## ✨ Features Overview

### 1. 🛡️ Zero-Knowledge Encryption
* **Client-Side Only:** Files are encrypted using **AES-256-GCM** immediately upon selection.
* **Non-Custodial Keys:** Encryption keys are generated in the browser. The server only receives encrypted blobs (`.enc` files).
* **Device Keys:** Users generate secure **ECDH key pairs** stored locally (IndexedDB), ensuring seamless decryption without repetitive wallet signatures.

### 2. ⛓️ On-Chain Ownership (The "Hybrid" Model)
* **Proof of Ownership:** Every file upload mints a "digital title" on Optimism (mapping `FileHash` → `OwnerAddress`).
* **Decentralized Access Control:** The API checks the **Blockchain State** via Alchemy before allowing any sensitive DB operations (like sharing or deleting).
* **Censorship Resistant:** Even if the database is wiped, the proof of ownership remains on-chain.

### 3. ☁️ Secure Upload Pipeline
* **No Leaked Keys:** Unlike standard DApps, we do not expose IPFS keys to the browser.
* **Streaming Proxy:** The Next.js API route streams the encrypted blob directly to Pinata, ensuring security without sacrificing performance.
* **Resilience:** The upload engine features exponential backoff and timeout handling to support unstable networks (e.g., WSL2 environments).

### 4. 🤝 Secure Sharing & Access Control
* **Key Wrapping:** Share files without re-uploading. The file's AES key is "wrapped" (encrypted) using the Recipient's Public Key.
* **Granular Access:** Grant read access to specific wallet addresses (DIDs).
* **Instant Revocation:** Owners can revoke access instantly by deleting the recipient's wrapped key from the database.

### 5. 🔍 Compliance & Auditing
* **Audit Trails:** Every action (Upload, Decrypt, Share, Revoke, Delete) is logged immutably in the `AuditLog` table.
* **SIWE Auth:** Authentication is handled via **Sign-In With Ethereum**, binding every session to a verifiable wallet signature.

---

## 🏗️ Architecture

The system uses an **Envelope Encryption** architecture to manage keys securely.

### High-Level Components

| Component | Technology | Responsibility |
| :--- | :--- | :--- |
| **Frontend** | Next.js 14 | Client-side Encryption/Decryption, Wallet Logic |
| **API Proxy** | Next.js API Routes | Securely pinning files to IPFS (Hides API Keys) |
| **Identity** | SIWE + JWT | Auth Session Management |
| **Database** | Supabase | Storing Encrypted Keys (WrappedKeys), Metadata |
| **Blockchain** | Optimism Mainnet | Truth source for "Who owns this file hash?" |

---

## 🧠 The Encryption Logic (Deep Dive)

### The Master File Key (FK)
A random **256-bit AES key** generated for each file.

### The Lockbox (Wrapped Keys)
* The **FK** is never stored plainly.
* It is encrypted using the Owner's Public Key and stored in the `WrappedKey` table.

### Access Granting
To share with Bob, the Owner's browser performs the following sequence:
1.  Decrypts **FK**.
2.  Re-encrypts **FK** with **Bob's Public Key**.
3.  Uploads the new entry to the `WrappedKey` table.

---

## 📦 Setup & Installation

### 1. Environment Variables
Copy `.env.example` to `packages/nextjs/.env.local`.

**⚠️ Security Note:** Do NOT add `NEXT_PUBLIC_PINATA_JWT`. It is no longer needed on the client.

```bash
# Blockchain Config
NEXT_PUBLIC_CHAIN_ID="10" # Optimism Mainnet
NEXT_PUBLIC_ALCHEMY_API_KEY="your_alchemy_api_key" # Key only, not URL
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID="your_wc_id"

# Database (Supabase)
NEXT_PUBLIC_SUPABASE_URL="[https://xyz.supabase.co](https://xyz.supabase.co)"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your_anon_key"
SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" # Server-only!

# Storage (Pinata) - Server Side Only
PINATA_JWT="your_pinata_jwt"
```

### 2. Smart Contracts
Deploy to Optimism Mainnet using Hardhat.

```bash

cd packages/hardhat


# 1. Clean previous builds
yarn clean && yarn compile

# 2. Deploy to Optimism
yarn deploy --network optimism

# 3. Verify on Etherscan
yarn verify --network optimism <DEPLOYED_ADDRESS>
```
### 3. Frontend
Start the Next.js app locally (connected to Mainnet).

```bash

cd packages/nextjs
yarn install
yarn start
Visit http://localhost:3000.
```

## 🔐 Security & Deployment Notes
**API Keys**: Ensure PINATA_JWT and SUPABASE_SERVICE_ROLE_KEY are never exposed to the client (no NEXT_PUBLIC_ prefix).

**OpenZeppelin Manifest**: Always commit the .openzeppelin folder. It contains the storage layout required for future contract upgrades.

**RPC Limits**: The app is configured to use Alchemy for high-reliability reads. Ensure your Alchemy allowlist includes your production domain.