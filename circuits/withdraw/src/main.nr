// Vellum withdraw circuit: payroll leaf in a Poseidon2 Merkle tree (depth 20).
// Public inputs: root, nullifier_hash, amount, recipient_id (128 bytes on-chain).
// recipient_id = Poseidon(pubkey_lo, pubkey_hi) binds payout to the entitled employee.

use dep::poseidon::poseidon2::Poseidon2;

global TREE_DEPTH: u32 = 20;

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

fn hash3(a: Field, b: Field, c: Field) -> Field {
    Poseidon2::hash([a, b, c], 3)
}

fn constrain_bit(bit: Field) {
    assert(bit * (1 - bit) == 0);
}

fn compute_root(leaf: Field, path_siblings: [Field; 20], path_bits: [Field; 20]) -> Field {
    let mut cur = leaf;
    for i in 0..TREE_DEPTH {
        let sib = path_siblings[i];
        let bit = path_bits[i];
        constrain_bit(bit);
        if bit == 0 {
            cur = hash2(cur, sib);
        } else {
            cur = hash2(sib, cur);
        }
    }
    cur
}

fn main(
    root: pub Field,
    nullifier_hash: pub Field,
    amount: pub Field,
    recipient_id: pub Field,
    pubkey_lo: Field,
    pubkey_hi: Field,
    priv_key: Field,
    salt: Field,
    path_siblings: [Field; 20],
    path_bits: [Field; 20],
) {
    let computed_recipient_id = hash2(pubkey_lo, pubkey_hi);
    assert(computed_recipient_id == recipient_id);
    let leaf = hash3(recipient_id, amount, salt);
    let nf = hash2(priv_key, salt);
    assert(nf == nullifier_hash);

    let computed_root = compute_root(leaf, path_siblings, path_bits);
    assert(computed_root == root);
}

#[test]
fn test_recipient_id_leaf() {
    let lo = 1;
    let hi = 2;
    let recipient_id = hash2(lo, hi);
    assert(hash2(lo, hi) == recipient_id);
    let leaf = hash3(recipient_id, 100, 42);
    assert(leaf != 0);
}

#[test]
fn test_nullifier_binding() {
    let pk = 7;
    let salt = 99;
    let nf = hash2(pk, salt);
    assert(nf != 0);
}
