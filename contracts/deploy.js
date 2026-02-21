// Deployment script for Diamond Claws contracts
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy DiamondClaws (DCLAW) token
  console.log("\nDeploying DiamondClaws token...");
  const DiamondClaws = await hre.ethers.getContractFactory("DiamondClaws");
  const dclaw = await DiamondClaws.deploy(deployer.address, deployer.address);
  await dclaw.deployed();
  console.log("DiamondClaws deployed to:", dclaw.address);

  // Deploy Staking contract
  console.log("\nDeploying DiamondClawsStaking...");
  const DiamondClawsStaking = await hre.ethers.getContractFactory("DiamondClawsStaking");
  const staking = await DiamondClawsStaking.deploy(dclaw.address, deployer.address, deployer.address);
  await staking.deployed();
  console.log("DiamondClawsStaking deployed to:", staking.address);

  // Set staking contract in token
  console.log("\nSetting staking contract in token...");
  await dclaw.setStakingContract(staking.address);

  // Verify contracts on Etherscan (if not local)
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("\nVerifying contracts...");
    try {
      await hre.run("verify:verify", {
        address: dclaw.address,
        constructorArguments: [deployer.address, deployer.address],
      });
      console.log("DiamondClaws verified");
      
      await hre.run("verify:verify", {
        address: staking.address,
        constructorArguments: [dclaw.address, deployer.address, deployer.address],
      });
      console.log("DiamondClawsStaking verified");
    } catch (e) {
      console.log("Verification failed:", e.message);
    }
  }

  console.log("\n========== DEPLOYMENT SUMMARY ==========");
  console.log("DiamondClaws (DCLAW):", dclaw.address);
  console.log("DiamondClawsStaking:", staking.address);
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
