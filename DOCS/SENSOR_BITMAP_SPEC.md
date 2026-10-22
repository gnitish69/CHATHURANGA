# CHĀTURANGA — 64-Bit Sensor Bitmap Specification

## 1. Overview
The physical CHĀTURANGA electronic chessboard uses an array of 64 magnetic reed switches (or Hall-effect sensors) embedded beneath each square of an 8×8 board. Pieces have small neodymium magnets embedded in their bases.

This document defines the official sensor bitmap convention used across:
1. Physical ESP32 firmware scanner (Phase 1 & beyond)
2. Browser Hardware Simulator (`sensorMatrix.js`)
3. Python Flask backend (`python-chess` bitboard integration)

---

## 2. Bit Ordering & Square Mapping

The sensor bitmap is a **64-bit unsigned integer (`uint64_t` / `BigInt`)**.
Square index follows standard **rank-by-rank algebraic ordering from a1 to h8**:

$$\text{Index} = (\text{Rank} - 1) \times 8 + \text{FileIndex}$$

Where:
- $\text{FileIndex} \in [0..7]$ corresponding to files $\text{a}=0, \text{b}=1, \text{c}=2, \dots, \text{h}=7$.
- $\text{Rank} \in [1..8]$.

### Square to Bit Mapping Table:

| Square | Rank | File | Bit Index | Significance |
|:------:|:----:|:----:|:---------:|:------------:|
| **a1** | 1 | a (0) | **0** | **LSB (Bit 0)** |
| **b1** | 1 | b (1) | **1** | Bit 1 |
| **c1** | 1 | c (2) | **2** | Bit 2 |
| **d1** | 1 | d (3) | **3** | Bit 3 |
| **e1** | 1 | e (4) | **4** | Bit 4 |
| **f1** | 1 | f (5) | **5** | Bit 5 |
| **g1** | 1 | g (6) | **6** | Bit 6 |
| **h1** | 1 | h (7) | **7** | Bit 7 |
| **a2** | 2 | a (0) | **8** | Bit 8 |
| ... | ... | ... | ... | ... |
| **h7** | 7 | h (7) | **55** | Bit 55 |
| **a8** | 8 | a (0) | **56** | Bit 56 |
| ... | ... | ... | ... | ... |
| **h8** | 8 | h (7) | **63** | **MSB (Bit 63)** |

### Python-chess Direct Compatibility
This convention is identical to the square indexing in `python-chess`:
```python
import chess

assert chess.A1 == 0
assert chess.B1 == 1
assert chess.H1 == 7
assert chess.A2 == 8
assert chess.H8 == 63
```

---

## 3. Bit Polarity

| Value | Physical Hardware State | Logical Meaning |
|:-----:|:-----------------------:|:---------------:|
| `1` | Magnet detected / Reed switch closed | **Occupied** (Piece present) |
| `0` | No magnet detected / Reed switch open | **Empty** (Square vacant) |

> **Critical Architectural Rule:**
> Reed switches detect **occupancy only**, NOT piece color or identity. A piece's identity is maintained exclusively by the authoritative chess game state (Mock engine in Phase 1, Flask `python-chess` in Phase 2).

---

## 4. Starting Position Bitmap

In the standard chess starting position:
- **Rank 1 (White pieces):** Squares a1 to h1 (bits 0 to 7) are all `1` $\rightarrow$ `0xFF`
- **Rank 2 (White pawns):** Squares a2 to h2 (bits 8 to 15) are all `1` $\rightarrow$ `0xFF`
- **Ranks 3, 4, 5, 6 (Empty center):** Bits 16 to 47 are all `0` $\rightarrow$ `0x00000000`
- **Rank 7 (Black pawns):** Squares a7 to h7 (bits 48 to 55) are all `1` $\rightarrow$ `0xFF`
- **Rank 8 (Black pieces):** Squares a8 to h8 (bits 56 to 63) are all `1` $\rightarrow$ `0xFF`

### Formats:
- **Big-Endian Hex String (16 hex chars):** `0xFFFF00000000FFFF`
- **BigInt representation:** `18446462598732840959n`
- **8-Byte Array (`uint8_t[8]`, rank 1 to 8):**
  `[0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF]`

---

## 5. Move Difference Computation (`diff`)

When physical sensors change, the difference between the previous stable bitmap $B_{\text{prev}}$ and new stable bitmap $B_{\text{curr}}$ is calculated via bitwise XOR:

$$\Delta = B_{\text{prev}} \oplus B_{\text{curr}}$$

For each set bit $i$ in $\Delta$:
- If $(B_{\text{prev}} \gg i) \& 1 == 1 \land (B_{\text{curr}} \gg i) \& 1 == 0$: Square is **LIFTED**.
- If $(B_{\text{prev}} \gg i) \& 1 == 0 \land (B_{\text{curr}} \gg i) \& 1 == 1$: Square is **PLACED**.

### Examples:
- **Move e2-e4 (White pawn advance):**
  - Bit 12 (e2): was 1, becomes 0 $\rightarrow$ `lifted: ["e2"]`
  - Bit 28 (e4): was 0, becomes 1 $\rightarrow$ `placed: ["e4"]`
  - Net piece count remains 32.
- **Move exd5 (Capture):**
  - Bit 12 (e4): was 1, becomes 0 $\rightarrow$ `lifted: ["e4"]`
  - Bit 35 (d5): was 1, becomes 1 (opponent pawn removed, White pawn placed) $\rightarrow$ sensor remains 1 after settling.
  - Net piece count becomes 31.
