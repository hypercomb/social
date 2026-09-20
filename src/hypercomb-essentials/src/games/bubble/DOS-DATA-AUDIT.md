# DOS campaign data audit

**Status: verified static comparison.**  This audit read compressed bytes only;
it did not execute, mount, copy, or unpack any DOS program into the repository.

## Reference identity

Read-only source directory:
`C:\Users\Jaime\Downloads\Bubble-Bobble_DOS_EN\bubble-bobble\bubble`.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `BUBBOB.DAT` | 71,538 | `665bb4b164d710cbfb77c58b97e7b7958668df45b2b1501b2d5af2fa0ce81e64` |
| `BDATA.CF` | 7,132 | `ea8a11beecb09409a61701e07f291ff59927aa65a5aa4aba8378ff7cbf300494` |
| `AIRFLOW.CF` | 1,728 | `b7a540d22889820065719d703f61793b13028f91e15372f9ab32f4caddbe5096` |
| `AIRBLOCK.CF` | 225 | `fd8328c694c4ee8ffc197ac4a17592acee57f753377d361c96e434f682a6a713` |

`BUBBOB.DAT` matches the provenance hash in `DOS-REFERENCE.md`.

## Decoder contract

- **Verified:** each `.CF` stream has a two-byte little-endian paragraph
  allocation followed by 9-to-12-bit, LSB-first LZW.  Codes `256` and `257`
  reset and end the dictionary.  The comparison used a standalone pure
  byte-reader/dictionary decoder, with no subprocess, emulator, network,
  filesystem write, or executable loading.
- **Verified decoded sizes/hashes:**

  | Resource | Decoded bytes | Allocation bytes | SHA-256 |
  | --- | ---: | ---: | --- |
  | `BDATA.CF` | 12,288 | 12,288 | `a68e77f458cd173090fc67d532e6b64849a16a3417550b073646a3d582a7e1ed` |
  | `AIRFLOW.CF` | 1,792 | 1,792 | `e1393e971139b8e2c72bdd0ea677b6c3874afdca52d3581e44525beb7ad7583a` |
  | `AIRBLOCK.CF` | 297 | 304 | `5d3301e94d841504dbcc43326ef161359fbc0a5828bb171083c73cfb720df173` |

  `AIRBLOCK.CF` ends at its LZW end marker before its allocation capacity;
  no synthetic padding was used in comparisons.

## Checked-in table comparison

| Checked-in source | Native decoded region | Result |
| --- | --- | --- |
| `dos-level-data.ts` `DOS_ROUND_ROWS` | `BDATA[0..10000)`: 100 records × 100 bytes | Exact byte equality |
| `dos-enemy-data.ts` `DOS_ROUND_ENEMIES` | `BDATA[0x2710..0x2e31)`: 100 lists, three-byte records terminated only when a record-boundary first byte is zero | Exact byte equality; 575 descriptors total; 463 decoded trailing bytes deliberately not interpreted here |
| `dos-air-data.ts` `DOS_AIRFLOW_SETTINGS` | `AIRFLOW[0..300)`: three 100-byte arrays | Exact byte equality |
| `dos-air-data.ts` `DOS_AIRFLOW_RECORDS` | `AIRFLOW[300..0x5a5)`: 100 length-prefixed/alias records | Exact byte equality; 347 trailing decoded bytes outside this table audit |
| `dos-air-data.ts` `DOS_AIRBLOCK_RECORDS` | `AIRBLOCK[0..0x127)`: 100 length-prefixed/alias records | Exact byte equality; two trailing decoded bytes outside this table audit |

For airflow/airblock records, a normal leading byte is the total record
length including itself; `00` and high-bit alias commands are single-byte
records.  Enemy parsing advances in three-byte descriptors and checks a zero
only at descriptor boundaries—valid descriptor fields themselves may be zero.

## Result and boundary

All 100 checked-in terrain rows, all 575 enemy descriptors, all three airflow
settings, and all 200 airflow/airblock patch records exactly reproduce the
corresponding decoded resource bytes.  This confirms campaign-data
transcription, not runtime interpretation of every trailing resource section,
graphics, audio, executable control flow, or scheduler timing.
