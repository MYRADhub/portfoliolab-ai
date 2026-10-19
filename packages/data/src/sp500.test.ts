import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@portfolio-lab/db/testing";
import { companies } from "@portfolio-lab/db";
import { loadConstituents, parseSp500Wikitext } from "./sp500";

const table = `intro
{| class="wikitable sortable" id="constituents"
|-
![[Ticker symbol|Symbol]]
! Security !! [[GICS]] Sector !! GICS Sub-Industry !! Headquarters Location !! Date added !! CIK !! Founded
|-
|| {{NyseSymbol|MMM}}
|| [[3M]]
|| Industrials 
|| Industrial Conglomerates 
|| [[Saint Paul, Minnesota]] 
|| 1957-03-04 
|| 0000066740
|| 1902
|-
|| {{NasdaqSymbol|AAPL}}
|| [[Apple Inc.]]<ref name="x"/>
|| Information Technology 
|| Technology Hardware 
|| [[Cupertino, California]] 
|| 1982-11-30 
|| 0000320193 
|| 1977
|-
|| {{NyseSymbol|BRK.B}} <!-- DO NOT CHANGE THIS TICKER TO BRK-B. -->
|| [[Berkshire Hathaway]]
|| Financials 
|| Multi-Sector Holdings 
|| [[Omaha, Nebraska]] 
|| 2010-02-16 
|| 0001067983 
|| 1839
|-
|| {{NyseSymbol|EME}}
|| [[Emcor]]|| Industrials 
|| Construction & Engineering 
|| [[Norwalk, Connecticut]] 
|| 2017-09-01 
|| 0000105 
|| 1994
|-
|| {{NyseSymbol|RMD}}
|| [[ResMed]]|
|| Health Care
|| Health Care Equipment
|| [[San Diego]], California
|| 2017-07-26
|| 0000943819
|| 1989
|}
trailer`;

describe("parseSp500Wikitext", () => {
  const rows = parseSp500Wikitext(table);

  it("parses rows and skips the header", () => {
    expect(rows.map((r) => r.ticker)).toEqual(["MMM", "AAPL", "BRK.B", "EME", "RMD"]);
    expect(rows[0]).toEqual({
      ticker: "MMM",
      name: "3M",
      sector: "Industrials",
      industry: "Industrial Conglomerates",
      dateAdded: "1957-03-04",
      cik: "0000066740",
    });
  });

  it("strips refs and html comments", () => {
    expect(rows[1]!.name).toBe("Apple Inc.");
    expect(rows[2]!.ticker).toBe("BRK.B");
  });

  it("handles rows with several cells on one line", () => {
    expect(rows[3]).toMatchObject({
      ticker: "EME",
      name: "Emcor",
      sector: "Industrials",
      industry: "Construction & Engineering",
    });
    expect(rows[3]!.cik).toBe("0000000105");
  });

  it("ignores stray trailing pipes in the source", () => {
    expect(rows[4]).toMatchObject({ ticker: "RMD", name: "ResMed", cik: "0000943819" });
  });

  it("throws when the table is missing", () => {
    expect(() => parseSp500Wikitext("nothing here")).toThrow(/not found/);
  });
});

describe("loadConstituents", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    ctx = await createTestDb();
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  it("upserts and updates changed metadata", async () => {
    const rows = parseSp500Wikitext(table);
    await loadConstituents(ctx.db, rows);
    await loadConstituents(ctx.db, [{ ...rows[0]!, sector: "Conglomerates" }]);
    const all = await ctx.db.select().from(companies);
    expect(all).toHaveLength(5);
    expect(all.find((c) => c.ticker === "MMM")!.sector).toBe("Conglomerates");
  });
});
