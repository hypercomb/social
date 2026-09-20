#!/usr/bin/env python3
"""Read-only inspector for a user-supplied Bubble Bobble unpacked image.

This utility deliberately has no unpacker, emulator, downloader, subprocess
calls, or write path. It validates the exact static-analysis image identity
before displaying any bytes or attempting optional disassembly.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Iterable, Sequence


EXPECTED_SIZE = 131_856
EXPECTED_SHA256 = "c0ab3aec0519cfbf22cee3fc3e3c6642e5a270f6fa8e68726dd172b9cecb0771"
MAX_RANGE_LENGTH = 4_096


class InspectError(Exception):
    """A refused static-inspection request."""


def integer(value: str) -> int:
    try:
        return int(value, 0)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"not an integer: {value!r}") from error


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, type=Path,
                        help="path to the user-supplied, already-unpacked image")
    parser.add_argument("--start", type=integer, default=0,
                        help="first static image offset (decimal or 0x-prefixed; default: 0)")
    parser.add_argument("--length", type=integer, default=64,
                        help="number of bytes to inspect (default: 64; maximum: 4096)")
    parser.add_argument("--disassemble", action="store_true",
                        help="also disassemble the selected range with an already-installed Capstone")
    parser.add_argument("--cs", type=integer, default=0,
                        help="display CS for direct near targets (default: 0; display only)")
    return parser.parse_args(argv)


def validate_range(start: int, length: int) -> None:
    if start < 0:
        raise InspectError("--start must be non-negative")
    if length <= 0:
        raise InspectError("--length must be positive")
    if length > MAX_RANGE_LENGTH:
        raise InspectError(f"--length must not exceed {MAX_RANGE_LENGTH}")
    if start >= EXPECTED_SIZE or start + length > EXPECTED_SIZE:
        raise InspectError(
            f"range 0x{start:X}..0x{start + length:X} lies outside the "
            f"0x0..0x{EXPECTED_SIZE:X} image")


def verified_bytes(path: Path) -> bytes:
    try:
        with path.open("rb") as source:
            image = source.read()
    except OSError as error:
        raise InspectError(f"cannot read --image {path}: {error}") from error
    if len(image) != EXPECTED_SIZE:
        raise InspectError(f"image size {len(image)} does not equal expected {EXPECTED_SIZE}")
    actual = hashlib.sha256(image).hexdigest()
    if actual != EXPECTED_SHA256:
        raise InspectError(
            "image SHA-256 does not match the recorded static-analysis image: "
            f"expected {EXPECTED_SHA256}, got {actual}")
    return image


def byte_lines(image: bytes, start: int, length: int) -> Iterable[str]:
    end = start + length
    for offset in range(start, end, 16):
        chunk = image[offset:min(offset + 16, end)]
        hex_bytes = " ".join(f"{byte:02X}" for byte in chunk)
        ascii_bytes = "".join(chr(byte) if 0x20 <= byte <= 0x7E else "." for byte in chunk)
        yield f"{offset:04X}: {hex_bytes:<47}  |{ascii_bytes}|"


def direct_near_target(operands: Sequence[object], immediate_type: int) -> int | None:
    """Return an IP only for a one-operand direct relative transfer.

    Far x86 calls/jumps carry segment and offset operands. They deliberately
    receive no CS:IP annotation here: Capstone's original text is less
    misleading than treating a far segment as a masked near offset.
    """
    if len(operands) != 1 or getattr(operands[0], "type", None) != immediate_type:
        return None
    return int(getattr(operands[0], "imm")) & 0xFFFF


def disassembly_lines(image: bytes, start: int, length: int, cs: int) -> Iterable[str]:
    try:
        from capstone import CS_ARCH_X86, CS_GRP_CALL, CS_GRP_JUMP, CS_MODE_16, CS_OP_IMM, Cs
    except ImportError as error:
        raise InspectError(
            "--disassemble requires an already-installed Capstone Python module; "
            "install it only in an external analysis environment, not this repository") from error

    disassembler = Cs(CS_ARCH_X86, CS_MODE_16)
    disassembler.detail = True
    selected = image[start:start + length]
    yield "disassembly is static only; direct near targets are displayed as CS:IP with IP masked to 16 bits"
    for instruction in disassembler.disasm(selected, start):
        text = f"{instruction.address:04X}: {instruction.bytes.hex(' ').upper():<23} {instruction.mnemonic} {instruction.op_str}".rstrip()
        if instruction.group(CS_GRP_CALL) or instruction.group(CS_GRP_JUMP):
            target = direct_near_target(instruction.operands, CS_OP_IMM)
            if target is not None:
                text += f"  ; direct near target {cs & 0xFFFF:04X}:{target:04X} (IP masked 16-bit)"
        yield text


def run(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        validate_range(args.start, args.length)
        image = verified_bytes(args.image)
        print(f"verified static image: {args.image} ({EXPECTED_SIZE} bytes, SHA-256 {EXPECTED_SHA256})")
        print(f"static byte range: 0x{args.start:04X}..0x{args.start + args.length:04X}")
        for line in byte_lines(image, args.start, args.length):
            print(line)
        if args.disassemble:
            for line in disassembly_lines(image, args.start, args.length, args.cs):
                print(line)
    except InspectError as error:
        print(f"refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
