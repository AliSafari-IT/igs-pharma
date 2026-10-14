-- igs-pharma#103: storefront search. pg_trgm is a trusted contrib extension (created here by the
-- migrator role, like citext in the first migration); the generated column folds case and accents
-- with built-in functions only (multi-character folds such as oe/ae/ss are deliberately not applied),
-- and the trigram GIN index serves `LIKE '%term%'`. Adding a STORED generated column rewrites
-- product_content once (a few thousand rows at most today); no other table is touched.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "catalog"."product_content" ADD COLUMN "search_text" text GENERATED ALWAYS AS (translate(lower(name || ' ' || coalesce(short_description, '')), 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž', 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijkllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz')) STORED;--> statement-breakpoint
CREATE INDEX "product_content_search_text_trgm_idx" ON "catalog"."product_content" USING gin ("search_text" gin_trgm_ops);