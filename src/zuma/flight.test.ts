import { describe, expect, it } from "vitest";
import { createFlight, sideFromContact } from "./flight.ts";

describe("sideFromContact", () => {
  it("puts the ball in front when the contact faces the end of the path", () => {
    expect(sideFromContact(1, 0, 1, 0)).toBe("before");
    expect(sideFromContact(0, 1, 0.2, 0.8)).toBe("before");
  });

  it("puts the ball behind when the contact faces the start", () => {
    expect(sideFromContact(1, 0, -1, 0)).toBe("after");
    expect(sideFromContact(0, 1, 0, -0.2)).toBe("after");
  });
});

describe("flight", () => {
  it("moves a shot about one second of its speed", () => {
    const flight = createFlight();
    flight.launch(0, 0, 740, 0, 12);
    for (let i = 0; i < 60; i++) flight.step(1 / 60);
    const pos = flight.position();
    expect(pos?.x).toBeGreaterThan(600);
    expect(pos?.x).toBeLessThan(900);
    flight.clear();
  });

  it("reports the track ball a shot runs into", () => {
    const flight = createFlight();
    flight.sync([{ key: "0:1", x: 180, y: 0, radius: 12 }]);
    flight.launch(0, 0, 740, 0, 12);
    let hit = null;
    for (let i = 0; i < 40 && !hit; i++) {
      flight.step(1 / 60);
      hit = flight.takeHit();
    }
    expect(hit?.key).toBe("0:1");
    flight.clear();
  });
});
