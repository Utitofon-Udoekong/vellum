use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::{Bytes, BytesN, Env, U256, Vec as SorobanVec};

pub const TREE_DEPTH: u32 = 20;
pub const MAX_LEAVES: u32 = 1u32 << TREE_DEPTH;

pub fn key_frontier_prefix() -> soroban_sdk::Symbol {
    soroban_sdk::symbol_short!("fr")
}

pub fn key_next_index() -> soroban_sdk::Symbol {
    soroban_sdk::symbol_short!("idx")
}

pub fn key_root() -> soroban_sdk::Symbol {
    soroban_sdk::symbol_short!("root")
}

pub fn poseidon2_hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let modulus = Bn254Fr::modulus(env);
    let a_bytes = Bytes::from_array(env, &a.to_array());
    let b_bytes = Bytes::from_array(env, &b.to_array());
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, Bn254Fr>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut out_arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut out_arr);
    BytesN::from_array(env, &out_arr)
}

pub fn zeroes_for_tree(env: &Env) -> alloc::vec::Vec<BytesN<32>> {
    let mut zeroes = alloc::vec::Vec::with_capacity(TREE_DEPTH as usize + 1);
    let mut cur = BytesN::from_array(env, &[0u8; 32]);
    zeroes.push(cur.clone());
    for _ in 0..TREE_DEPTH {
        cur = poseidon2_hash2(env, &cur, &cur);
        zeroes.push(cur.clone());
    }
    zeroes
}

/// Insert a commitment leaf into the incremental frontier Merkle tree.
pub fn insert_commitment(env: &Env, commitment: BytesN<32>) -> Result<u32, ()> {
    let zeroes = zeroes_for_tree(env);
    let mut next_index: u32 = env
        .storage()
        .instance()
        .get(&key_next_index())
        .unwrap_or(0u32);
    if next_index >= MAX_LEAVES {
        return Err(());
    }
    let idx = next_index;
    let ins_idx = next_index;
    let mut cur = commitment;
    let mut i = 0u32;
    while i < TREE_DEPTH {
        let bit = (ins_idx >> i) & 1;
        if bit == 0 {
            let fk = (key_frontier_prefix(), i);
            env.storage().instance().set(&fk, &cur);
            let z = &zeroes[i as usize];
            cur = poseidon2_hash2(env, &cur, z);
        } else {
            let fk = (key_frontier_prefix(), i);
            let left: BytesN<32> = env
                .storage()
                .instance()
                .get(&fk)
                .unwrap_or_else(|| zeroes[i as usize].clone());
            cur = poseidon2_hash2(env, &left, &cur);
        }
        i += 1;
    }
    env.storage().instance().set(&key_root(), &cur);
    next_index = next_index.saturating_add(1);
    env.storage().instance().set(&key_next_index(), &next_index);
    Ok(idx)
}

pub fn get_root(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&key_root())
}

pub fn reset_tree(env: &Env) {
    env.storage().instance().remove(&key_root());
    env.storage().instance().remove(&key_next_index());
    for i in 0..TREE_DEPTH {
        env.storage().instance().remove(&(key_frontier_prefix(), i));
    }
}

pub fn commitment_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&key_next_index())
        .unwrap_or(0u32)
}
