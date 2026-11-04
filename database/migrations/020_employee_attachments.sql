CREATE TABLE employee_attachments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 employee_id bigint NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
 direction text NOT NULL CHECK(direction IN ('incoming','outgoing')),
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
 mime_type text NOT NULL,
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 storage_id text NOT NULL UNIQUE,
 uploaded_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX employee_attachments_list_idx ON employee_attachments(employee_id,direction,id DESC);
