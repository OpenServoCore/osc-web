import { expect, test } from "vitest";
import { ID_MAX, ID_MIN, idIssue, rescans, selectAfter, type ManageAction } from "./manage";

const ACTIONS: ManageAction[] = ["assign", "save", "reboot", "factory"];

test("an id inside the range, unused and not the current one, is accepted", () => {
  expect(idIssue(7, 2, [1, 2])).toBeUndefined();
  expect(idIssue(ID_MIN, 2, [2])).toBeUndefined();
  expect(idIssue(ID_MAX, 2, [2])).toBeUndefined();
});

test("an id outside 1 to 249 is refused", () => {
  expect(idIssue(0, 2, [2])).toBe("Ids are 1 to 249.");
  expect(idIssue(250, 2, [2])).toBe("Ids are 1 to 249.");
  expect(idIssue(-1, 2, [2])).toBe("Ids are 1 to 249.");
});

test("a fractional or unparsed id is refused before the range", () => {
  expect(idIssue(NaN, 2, [2])).toBe("Ids are whole numbers.");
  expect(idIssue(7.5, 2, [2])).toBe("Ids are whole numbers.");
});

test("the servo's own id is refused, and so is one another servo answers at", () => {
  expect(idIssue(2, 2, [1, 2])).toBe("This servo is already ID 2.");
  expect(idIssue(1, 2, [1, 2])).toBe("ID 1 is taken by another servo.");
  expect(idIssue(1, 2, [2])).toBeUndefined();
});

test("every action but Save rescans", () => {
  expect(ACTIONS.filter(rescans)).toEqual(["assign", "reboot", "factory"]);
});

test("only Assign re-selects, onto the id it handed out", () => {
  expect(selectAfter("assign", 7)).toBe(7);
  for (const action of ACTIONS.filter((a) => a !== "assign")) {
    expect(selectAfter(action, 7)).toBeUndefined();
  }
});
