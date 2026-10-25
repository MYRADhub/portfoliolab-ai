CREATE TABLE IF NOT EXISTS "benchmark_prices" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"adj_close" double precision NOT NULL,
	CONSTRAINT "benchmark_prices_symbol_date_pk" PRIMARY KEY("symbol","date")
);
