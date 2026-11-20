import { NextRequest, NextResponse } from "next/server";
import { retrieveQuotes } from "@/lib/market/provider";
import { symbolPattern } from "@/lib/schema";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ message: "Same-origin requests only." }, { status: 403, headers });
  }
  const input = request.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [...new Set(input.split(","))];
  if (symbols.length > 24 || !symbols.every((symbol) => symbolPattern.test(symbol))) {
    return NextResponse.json({ message: "Supply between 1 and 24 valid US tickers." }, { status: 400, headers });
  }
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) {
    return NextResponse.json({ quotes: [], issues: {}, configured: false, message: "Add a Finnhub API key to connect market data." }, { headers });
  }
  const data = await retrieveQuotes(symbols, key, request.nextUrl.searchParams.get("refresh") === "1");
  return NextResponse.json(data, { headers });
}
