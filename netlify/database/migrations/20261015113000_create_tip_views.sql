CREATE TABLE tip_views (
  tip_id TEXT NOT NULL,
  visitor_id UUID NOT NULL,
  view_day DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tip_id, visitor_id, view_day)
);
CREATE INDEX tip_views_day_idx ON tip_views (view_day, tip_id);
