# 👑 Sovereign: The MEV Executioner

> **An adaptive, front-running immune trading agent built for the Creator.bid Battleground.**

Sovereign is a highly evolved algorithmic trading bot designed to dominate the Creator.bid PvP Agent Trading Competition. While other bots rely on simple moving averages or easily exploitable end-of-round liquidation snipes, Sovereign uses dynamic game theory and MEV-aware execution to hunt the front-runners.

## 🧠 Core Strategy & Architecture

Sovereign abandons traditional, static trading logic in favor of a three-phased, adaptive lifecycle designed to extract maximum USDC while remaining completely immune to "pump and dump" predators like `crimson-mantis`.

### 1. The "One-and-Done" Mid-Battle Scalp
Instead of engaging in the chaotic bloodbath at the market open (where high-frequency MEV bots steal liquidity), Sovereign waits patiently. 
- It scans the market for a massive, organic -35% dip from the all-time high.
- Upon detecting the crash, it executes a precise 100 USDC TWAP (Time-Weighted Average Price) buy to establish a rock-solid cost basis.
- The moment the dead-cat bounce hits +15% profit, Sovereign instantly fires a TWAP sell transaction. 
- It takes its guaranteed +15% profit and immediately exits the mid-battle arena, completely safe from subsequent crashes.

### 2. The "Dead-Coin" Filter
At the end of every round, the Creator.bid protocol dissolves the remaining liquidity. Many bots blindly buy at the end of the round to secure a percentage of this dissolution pot. 
Sovereign analyzes the math before engaging. If a token has crashed below 20% of its peak (a true rug pull), Sovereign refuses to buy, saving its capital. It only engages if the pool is "rich" in USDC relative to the token supply, guaranteeing a profitable dissolution payout.

### 3. The "Anaconda Squeeze" (MEV Defense)
This is Sovereign's crown jewel. The top bots in the arena learned to front-run massive end-of-round buys by purchasing early and dumping their bags on the liquidity spikes created by other bots. 
To destroy these front-runners, Sovereign employs the **Anaconda Strategy**:
- Instead of firing a massive 400 USDC transaction at the end of the round, Sovereign slices its budget into **8 micro-chunks of 50 USDC**.
- It fires these chunks relentlessly over the final 30 seconds with zero sleep delay.
- When front-running bots attempt to exit, they are forced to sell their massive token bags into our tiny 50 USDC liquidity pumps. 
- This violently crashes their exit price to the absolute floor, allowing Sovereign to vacuum up a massive percentage of the token supply at a -95% discount just seconds before the buzzer.
- Sovereign steals the front-runners' exit liquidity and claims the massive dissolution payout for itself.

## 📊 Proven Results
Sovereign is currently running live in the arena and consistently securing Top 3 finishes on the Global Leaderboard. 

By executing the Anaconda squeeze, Sovereign has successfully neutralized the #1 ranked bots, bleeding their capital dry and locking in massive +230 USDC profits per battle. 

### EMBERTHRONE Victory (+234 USDC)
![EMBERTHRONE Leaderboard and Anaconda Squeeze](assets/emberthrone.png)

### BONEGARDEN Squeeze (+41 USDC against front-runners)
![BONEGARDEN Squeeze](assets/bonegarden.png)

### MEV Scalping & Front-Running Defense
Even when heavily front-run by MEV bots causing 10+ seconds of transaction latency, Sovereign secures its scalp profit target safely.
![Scalp Proof](assets/scalp_proof.png)

## 🛠 Tech Stack
- **Node.js** & **Ethers.js v6**
- **Custom Asynchronous TWAP Engine**
- **Dynamic Slippage & Gas Optimization**

---
*Built to win the Battleground Alpha.*
