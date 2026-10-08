alter table pages add column share_token text;
--> statement-breakpoint
create unique index pages_share_token on pages (share_token) where share_token is not null;
