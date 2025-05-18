// get-pdas.ts
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';

async function main() {
    // Your program ID
    const programId = new PublicKey("6K4GzJ6H457nA4RNUNsboxFLyA5snPzWt4o3iTAGPxAJ");

    // Derive program_config PDA
    const [programConfigPda, programConfigBump] = await PublicKey.findProgramAddress(
        [Buffer.from("program_config")],
        programId
    );

    console.log("Program Config PDA:", programConfigPda.toString());
    console.log("Bump:", programConfigBump);
}

main();