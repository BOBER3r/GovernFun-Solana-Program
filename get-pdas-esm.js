import { PublicKey } from '@solana/web3.js';

async function findProgramAddress(seeds, programId) {
  const [publicKey, nonce] = await PublicKey.findProgramAddress(seeds, programId);
  return [publicKey.toString(), nonce];
}

async function main() {
  // Your program ID
  const programId = new PublicKey("6K4GzJ6H457nA4RNUNsboxFLyA5snPzWt4o3iTAGPxAJ");
  
  // Derive program_config PDA
  const [programConfigPda, programConfigBump] = await findProgramAddress(
    [Buffer.from("program_config")],
    programId
  );
  
  console.log("Program Config PDA:", programConfigPda);
  console.log("Bump:", programConfigBump);
}

main();
