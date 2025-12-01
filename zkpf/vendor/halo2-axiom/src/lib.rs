//! # halo2-axiom
//! This is a fork of <https://github.com/privacy-scaling-explorations/halo2>, which is itself a fork of ZCash's "halo2_proofs" crate.
//! This fork uses the KZG polynomial commitment scheme for the proving backend.
//! Publishing this crate for better versioning in Axiom's production usage.

#![cfg_attr(docsrs, feature(doc_cfg))]
// The actual lints we want to disable.

// #![deny(missing_docs)]
// #![deny(unsafe_code)]

pub mod arithmetic;
pub mod circuit;
pub use halo2curves;
pub mod fft;
mod multicore;
pub mod plonk;
pub mod poly;
pub mod transcript;

pub mod dev;
mod helpers;
pub use helpers::SerdeFormat;
