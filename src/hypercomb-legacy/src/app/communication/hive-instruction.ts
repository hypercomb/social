export interface HiveInstruction {
  neighborIndex: 0 | 1 | 2 | 3 | 4 | 5;
  direction: 0 | 1;
  pheromone: 0 | 1 | 2 | 3;   // 00, 01, 10, 11
  mode: 0 | 1 | 2 | 3;        // 00, 01, 10, 11
}