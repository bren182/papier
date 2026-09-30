-- Full-text index over search_rows.text (external content: the text lives once, in
-- search_rows). The triggers are the standard FTS5 external-content sync.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
	text,
	content='search_rows',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2',
	prefix='2 3'
);
--> statement-breakpoint
CREATE TRIGGER `search_rows_ai` AFTER INSERT ON `search_rows` BEGIN
	INSERT INTO search_fts(rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER `search_rows_ad` AFTER DELETE ON `search_rows` BEGIN
	INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER `search_rows_au` AFTER UPDATE OF `text` ON `search_rows` BEGIN
	INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.id, old.text);
	INSERT INTO search_fts(rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
-- Page titles are already plain text. Block text needs JS (plainText) and is
-- backfilled on startup by backfillSearch().
INSERT INTO `search_rows` (`page_id`, `text`) SELECT `id`, `title` FROM `pages`;
