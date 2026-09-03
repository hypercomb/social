// Self-register the headless, bounded native tree reader. The implementation
// stays in a pure importable module so its history semantics can be tested
// without booting the essentials side-effect graph.

import { HIVE_TREE_READER_IOC_KEY, HypercombHiveTreeReader } from './hive-tree-reader.js'

const hiveTreeReader = new HypercombHiveTreeReader()
window.ioc.register(HIVE_TREE_READER_IOC_KEY, hiveTreeReader)

