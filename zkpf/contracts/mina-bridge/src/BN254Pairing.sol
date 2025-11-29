// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BN254Pairing
 * @notice Library for BN254 curve operations using EVM precompiles
 * @dev Implements elliptic curve operations and pairing checks for SNARK verification.
 *
 * EVM Precompiles used:
 * - 0x06: ecAdd (point addition)
 * - 0x07: ecMul (scalar multiplication)
 * - 0x08: ecPairing (bilinear pairing check)
 *
 * BN254 curve equation: y² = x³ + 3
 * Base field (Fp): p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
 * Scalar field (Fr): r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
 */
library BN254Pairing {
    // ============================================================
    // CURVE CONSTANTS
    // ============================================================

    /// @notice Base field modulus p
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /// @notice Scalar field order r
    uint256 internal constant SCALAR_FIELD_ORDER =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Generator point G1.x
    uint256 internal constant G1_X = 1;

    /// @notice Generator point G1.y
    uint256 internal constant G1_Y = 2;

    /// @notice Precompile addresses
    address internal constant EC_ADD = address(0x06);
    address internal constant EC_MUL = address(0x07);
    address internal constant EC_PAIRING = address(0x08);

    // ============================================================
    // DATA STRUCTURES
    // ============================================================

    /// @notice A point on the G1 curve (affine coordinates)
    struct G1Point {
        uint256 x;
        uint256 y;
    }

    /// @notice A point on the G2 curve (affine coordinates with Fp2 elements)
    /// G2 points are over the extension field Fp2 = Fp[i]/(i² + 1)
    struct G2Point {
        uint256 x0; // Real part of x
        uint256 x1; // Imaginary part of x
        uint256 y0; // Real part of y
        uint256 y1; // Imaginary part of y
    }

    // ============================================================
    // ERRORS
    // ============================================================

    error PointNotOnCurve();
    error EcAddFailed();
    error EcMulFailed();
    error EcPairingFailed();
    error InvalidInputLength();

    // ============================================================
    // G1 OPERATIONS
    // ============================================================

    /**
     * @notice Get the generator point G1
     */
    function g1() internal pure returns (G1Point memory) {
        return G1Point(G1_X, G1_Y);
    }

    /**
     * @notice Check if a G1 point is the point at infinity (identity)
     */
    function isInfinity(G1Point memory p) internal pure returns (bool) {
        return p.x == 0 && p.y == 0;
    }

    /**
     * @notice Negate a G1 point
     * @dev Negation is (x, -y mod p)
     */
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (isInfinity(p)) {
            return G1Point(0, 0);
        }
        return G1Point(p.x, FIELD_MODULUS - (p.y % FIELD_MODULUS));
    }

    /**
     * @notice Add two G1 points using the ecAdd precompile
     */
    function add(
        G1Point memory p1,
        G1Point memory p2
    ) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = p2.x;
        input[3] = p2.y;

        bool success;
        assembly {
            success := staticcall(gas(), 0x06, input, 128, r, 64)
        }

        if (!success) {
            revert EcAddFailed();
        }
    }

    /**
     * @notice Scalar multiplication of a G1 point using the ecMul precompile
     */
    function scalarMul(
        G1Point memory p,
        uint256 s
    ) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 0x07, input, 96, r, 64)
        }

        if (!success) {
            revert EcMulFailed();
        }
    }

    /**
     * @notice Multi-scalar multiplication (MSM) over G1
     * @dev Computes sum(points[i] * scalars[i])
     */
    function msm(
        G1Point[] memory points,
        uint256[] memory scalars
    ) internal view returns (G1Point memory result) {
        require(points.length == scalars.length, "Length mismatch");

        result = G1Point(0, 0); // Identity

        for (uint256 i = 0; i < points.length; i++) {
            G1Point memory term = scalarMul(points[i], scalars[i]);
            result = add(result, term);
        }
    }

    // ============================================================
    // PAIRING OPERATIONS
    // ============================================================

    /**
     * @notice Verify a single pairing equation: e(p1, q1) == e(p2, q2)
     * @dev Returns true if e(p1, q1) * e(-p2, q2) == 1
     */
    function pairingCheck(
        G1Point memory p1,
        G2Point memory q1,
        G1Point memory p2,
        G2Point memory q2
    ) internal view returns (bool) {
        G1Point memory neg_p2 = negate(p2);

        uint256[12] memory input;

        // First pairing: e(p1, q1)
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = q1.x1;
        input[3] = q1.x0;
        input[4] = q1.y1;
        input[5] = q1.y0;

        // Second pairing: e(-p2, q2)
        input[6] = neg_p2.x;
        input[7] = neg_p2.y;
        input[8] = q2.x1;
        input[9] = q2.x0;
        input[10] = q2.y1;
        input[11] = q2.y0;

        uint256[1] memory result;
        bool success;

        assembly {
            success := staticcall(gas(), 0x08, input, 384, result, 32)
        }

        if (!success) {
            revert EcPairingFailed();
        }

        return result[0] == 1;
    }

    /**
     * @notice Verify a batch pairing equation: ∏ e(p[i], q[i]) == 1
     * @dev Used for Groth16 verification with 3 pairings
     */
    function pairingCheckBatch(
        G1Point[] memory p,
        G2Point[] memory q
    ) internal view returns (bool) {
        require(p.length == q.length, "Length mismatch");
        require(p.length > 0, "Empty input");

        uint256 inputSize = p.length * 6 * 32; // 6 uint256 per pairing pair
        bytes memory input = new bytes(inputSize);

        for (uint256 i = 0; i < p.length; i++) {
            uint256 offset = i * 192; // 6 * 32 bytes per pair

            // G1 point
            bytes32 px = bytes32(p[i].x);
            bytes32 py = bytes32(p[i].y);

            // G2 point (note: x1,x0,y1,y0 ordering for precompile)
            bytes32 qx1 = bytes32(q[i].x1);
            bytes32 qx0 = bytes32(q[i].x0);
            bytes32 qy1 = bytes32(q[i].y1);
            bytes32 qy0 = bytes32(q[i].y0);

            assembly {
                mstore(add(add(input, 32), offset), px)
                mstore(add(add(input, 64), offset), py)
                mstore(add(add(input, 96), offset), qx1)
                mstore(add(add(input, 128), offset), qx0)
                mstore(add(add(input, 160), offset), qy1)
                mstore(add(add(input, 192), offset), qy0)
            }
        }

        uint256[1] memory result;
        bool success;

        assembly {
            success := staticcall(
                gas(),
                0x08,
                add(input, 32),
                inputSize,
                result,
                32
            )
        }

        if (!success) {
            revert EcPairingFailed();
        }

        return result[0] == 1;
    }

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    /**
     * @notice Check if a point is on the BN254 G1 curve (y² = x³ + 3)
     */
    function isOnCurveG1(G1Point memory p) internal pure returns (bool) {
        if (isInfinity(p)) {
            return true;
        }

        uint256 lhs = mulmod(p.y, p.y, FIELD_MODULUS);
        uint256 rhs = addmod(
            mulmod(mulmod(p.x, p.x, FIELD_MODULUS), p.x, FIELD_MODULUS),
            3,
            FIELD_MODULUS
        );

        return lhs == rhs;
    }

    /**
     * @notice Parse a G1 point from bytes (64 bytes: x || y)
     */
    function parseG1(bytes memory data, uint256 offset) internal pure returns (G1Point memory) {
        require(data.length >= offset + 64, "Invalid G1 data");

        uint256 x;
        uint256 y;

        assembly {
            x := mload(add(add(data, 32), offset))
            y := mload(add(add(data, 64), offset))
        }

        return G1Point(x, y);
    }

    /**
     * @notice Parse a G2 point from bytes (128 bytes: x0 || x1 || y0 || y1)
     */
    function parseG2(bytes memory data, uint256 offset) internal pure returns (G2Point memory) {
        require(data.length >= offset + 128, "Invalid G2 data");

        uint256 x0;
        uint256 x1;
        uint256 y0;
        uint256 y1;

        assembly {
            x0 := mload(add(add(data, 32), offset))
            x1 := mload(add(add(data, 64), offset))
            y0 := mload(add(add(data, 96), offset))
            y1 := mload(add(add(data, 128), offset))
        }

        return G2Point(x0, x1, y0, y1);
    }

    /**
     * @notice Compute a linear combination: result = sum(coeffs[i] * points[i])
     */
    function linearCombination(
        uint256[] memory coeffs,
        G1Point[] memory points
    ) internal view returns (G1Point memory) {
        require(coeffs.length == points.length, "Length mismatch");

        G1Point memory result = G1Point(0, 0);

        for (uint256 i = 0; i < coeffs.length; i++) {
            if (coeffs[i] != 0) {
                G1Point memory term = scalarMul(points[i], coeffs[i]);
                result = add(result, term);
            }
        }

        return result;
    }
}

