import type { Interface } from "./types.js";

/**
 * Standard reusable interface definitions.
 */
export const STANDARD_INTERFACES: Record<string, Interface> = {
  i2c: {
    id: "i2c",
    ports: [
      { id: "SDA", role: "data" },
      { id: "SCL", role: "clock" },
      { id: "VCC", role: "power" },
      { id: "GND", role: "ground" },
    ],
  },
  spi: {
    id: "spi",
    ports: [
      { id: "MOSI", role: "data_out" },
      { id: "MISO", role: "data_in" },
      { id: "SCK", role: "clock" },
      { id: "CS", role: "chip_select" },
      { id: "VCC", role: "power" },
      { id: "GND", role: "ground" },
    ],
  },
  power_rail: {
    id: "power_rail",
    ports: [
      { id: "Vplus", role: "positive" },
      { id: "GND", role: "ground" },
    ],
  },
  uart: {
    id: "uart",
    ports: [
      { id: "TX", role: "transmit" },
      { id: "RX", role: "receive" },
      { id: "VCC", role: "power" },
      { id: "GND", role: "ground" },
    ],
  },
  analog_diff: {
    id: "analog_diff",
    ports: [
      { id: "Vplus", role: "positive" },
      { id: "Vminus", role: "negative" },
    ],
  },
};
