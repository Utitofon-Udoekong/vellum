use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::{Bytes, BytesN, Env, U256, Vec as SorobanVec};
use vellum_pool::merkle;

fn poseidon2_hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let modulus = Bn254Fr::modulus(env);
    let a_bytes = Bytes::from_array(env, &a.to_array());
    let b_bytes = Bytes::from_array(env, &b.to_array());
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, Bn254Fr>(env, &inputs);
    let mut out_arr = [0u8; 32];
    out.to_be_bytes().copy_into_slice(&mut out_arr);
    BytesN::from_array(env, &out_arr)
}

#[test]
fn zero_hash_chain_matches_merkle_zeroes() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();

    let zeroes = merkle::zeroes_for_tree(&env);
    assert_eq!(zeroes.len(), (merkle::TREE_DEPTH + 1) as usize);

    let mut cur = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(cur, zeroes[0]);

    for i in 0..merkle::TREE_DEPTH {
        cur = poseidon2_hash2(&env, &cur, &cur);
        assert_eq!(cur, zeroes[(i + 1) as usize]);
    }
}

#[test]
fn insert_single_leaf_at_index_zero() {
    use soroban_sdk::testutils::Address as _;
    use vellum_pool::{VellumPool, VellumPoolClient};

    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let admin = soroban_sdk::Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let pool_id = env.register(
        VellumPool,
        (
            admin,
            token,
            soroban_sdk::Address::generate(&env),
            soroban_sdk::Address::generate(&env),
        ),
    );
    let client = VellumPoolClient::new(&env, &pool_id);

    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let idx = client.deposit(&leaf);
    assert_eq!(idx, 0);

    let root = client.get_root().expect("root");
    let zeroes = merkle::zeroes_for_tree(&env);

    let mut cur = leaf;
    for i in 0..merkle::TREE_DEPTH {
        cur = poseidon2_hash2(&env, &cur, &zeroes[i as usize]);
    }
    assert_eq!(cur, root);
}
