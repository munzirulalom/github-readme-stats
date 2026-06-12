import { describe, expect, it } from "@jest/globals";
import { filterOrgs } from "../src/common/orgs.js";

describe("Test filterOrgs", () => {
  it("should return all orgs unchanged when neither param is provided", () => {
    const allOrgs = ["OrgA", "OrgB", "OrgC"];
    expect(filterOrgs(allOrgs, undefined, undefined)).toEqual([
      "OrgA",
      "OrgB",
      "OrgC",
    ]);
    expect(filterOrgs(allOrgs, null, null)).toEqual(["OrgA", "OrgB", "OrgC"]);
  });

  it("should return only whitelisted orgs when includeOrgs is provided", () => {
    const allOrgs = ["OrgA", "OrgB", "OrgC"];
    expect(filterOrgs(allOrgs, ["OrgA", "OrgC"], undefined)).toEqual([
      "OrgA",
      "OrgC",
    ]);
  });

  it("should match includeOrgs case-insensitively and keep original casing", () => {
    const allOrgs = ["MyOrg", "Other"];
    expect(filterOrgs(allOrgs, ["myorg"], undefined)).toEqual(["MyOrg"]);
  });

  it("should return all orgs except blacklisted when excludeOrgs is provided", () => {
    const allOrgs = ["OrgA", "OrgB", "OrgC"];
    expect(filterOrgs(allOrgs, undefined, ["OrgB"])).toEqual(["OrgA", "OrgC"]);
  });

  it("should match excludeOrgs case-insensitively and keep original casing", () => {
    const allOrgs = ["MyOrg", "Other"];
    expect(filterOrgs(allOrgs, undefined, ["myorg"])).toEqual(["Other"]);
  });

  it("should throw when both includeOrgs and excludeOrgs are provided", () => {
    const allOrgs = ["OrgA", "OrgB"];
    expect(() => filterOrgs(allOrgs, ["OrgA"], ["OrgB"])).toThrow(
      "`include_orgs` and `exclude_orgs` cannot be used together.",
    );
  });

  it("should treat empty arrays as not-provided", () => {
    const allOrgs = ["OrgA", "OrgB", "OrgC"];
    expect(filterOrgs(allOrgs, [], [])).toEqual(["OrgA", "OrgB", "OrgC"]);
  });

  it("should preserve the order of allOrgs in the output", () => {
    const allOrgs = ["Zebra", "Apple", "Mango"];
    expect(filterOrgs(allOrgs, ["mango", "zebra", "apple"], undefined)).toEqual(
      ["Zebra", "Apple", "Mango"],
    );
  });

  it("should not mutate the input arrays", () => {
    const allOrgs = ["OrgA", "OrgB", "OrgC"];
    const includeOrgs = ["OrgA"];
    const excludeOrgs = ["OrgB"];

    filterOrgs(allOrgs, includeOrgs, undefined);
    filterOrgs(allOrgs, undefined, excludeOrgs);
    filterOrgs(allOrgs, undefined, undefined);

    expect(allOrgs).toEqual(["OrgA", "OrgB", "OrgC"]);
    expect(includeOrgs).toEqual(["OrgA"]);
    expect(excludeOrgs).toEqual(["OrgB"]);
  });
});
