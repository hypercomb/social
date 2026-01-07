import { HiveInstruction } from "./hive-instruction";

export const encodeInstruction = (i: HiveInstruction): number => {
  return (
    ((i.mode & 0b11) << 6) |
    ((i.pheromone & 0b11) << 4) |
    ((i.direction & 0b1) << 3) |
    (i.neighborIndex & 0b111)
  ) & 0xFF;
};

export const decodeInstruction = (byte: number): HiveInstruction => ({
  neighborIndex: (byte & 0b111) as 0|1|2|3|4|5,
  direction: ((byte >> 3) & 0b1) as 0|1,
  pheromone: ((byte >> 4) & 0b11) as 0|1|2|3,
  mode: (byte >> 6) & 0b11
});
