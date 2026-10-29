-- =====================================================================
--  PAHINA Book Lovers' Club - Supabase schema
--  Supabase Dashboard -> SQL Editor -> New query -> paste ALL of this -> Run.
--  Safe to re-run on an empty project. (To reset: Database -> drop the tables first.)
--  Row Level Security (RLS) is what protects your data: the public "anon" key
--  in assets/js/config.js can only do what the policies below allow.
-- =====================================================================

-- ---------- PROFILES (one row per Supabase Auth user) ----------
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null,
  full_name      text not null check (char_length(full_name) between 3 and 120),
  student_id     text not null unique check (student_id ~ '^[A-Za-z0-9-]{3,20}$'),
  contact_number text not null check (contact_number ~ '^[0-9+\-\s]{7,20}$'),
  department     text not null,
  year_level     text not null,
  username       text not null unique check (username ~ '^[A-Za-z0-9_]{4,30}$'),
  role           text not null default 'member' check (role in ('admin','member')),
  status         text not null default 'active' check (status in ('active','inactive')),
  created_at     timestamptz not null default now()
);

-- ---------- CONTENT TABLES ----------
create table public.books (
  id               bigint generated always as identity primary key,
  isbn             text unique,
  title            text not null,
  author           text not null,
  category         text not null,
  publisher        text,
  publication_year smallint,
  description      text,
  cover_image      text,
  quantity         int not null default 1 check (quantity >= 0),
  available_copies int not null default 1 check (available_copies >= 0),
  status           text not null default 'available' check (status in ('available','borrowed','reserved')),
  created_at       timestamptz not null default now(),
  check (available_copies <= quantity)
);

create table public.announcements (
  id                bigint generated always as identity primary key,
  title             text not null,
  content           text not null,
  category          text not null default 'General',
  announcement_date date not null default current_date,
  image             text,
  posted_by         uuid references public.profiles(id) on delete set null,
  posted_by_name    text,
  status            text not null default 'published' check (status in ('published','draft')),
  created_at        timestamptz not null default now()
);

create table public.target_plans (
  id                 bigint generated always as identity primary key,
  title              text not null,
  objective          text not null,
  description        text,
  target_date        date not null,
  responsible_person text,
  status             text not null default 'planned' check (status in ('planned','ongoing','completed','cancelled')),
  progress           smallint not null default 0 check (progress between 0 and 100),
  created_at         timestamptz not null default now()
);

create table public.accomplishments (
  id              bigint generated always as identity primary key,
  title           text not null,
  activity_name   text not null,
  description     text,
  accomplishments text,
  participants    text,
  results         text,
  report_date     date not null,
  image           text,
  document        text,
  status          text not null default 'published' check (status in ('published','draft')),
  created_at      timestamptz not null default now()
);

create table public.officers (
  id         bigint generated always as identity primary key,
  position   text not null check (char_length(position) between 2 and 80),
  full_name  text not null check (char_length(full_name) between 3 and 120),
  course     text,
  photo      text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.activity_albums (
  id            bigint generated always as identity primary key,
  title         text not null check (char_length(title) between 2 and 150),
  description   text,
  activity_date date not null,
  created_at    timestamptz not null default now()
);

create table public.activity_photos (
  id         bigint generated always as identity primary key,
  album_id   bigint not null references public.activity_albums(id) on delete cascade,
  image      text not null,
  created_at timestamptz not null default now()
);

create table public.membership_applications (
  id             bigint generated always as identity primary key,
  full_name      text not null check (char_length(full_name) between 3 and 120),
  student_id     text not null check (student_id ~ '^[A-Za-z0-9-]{3,20}$'),
  email          text not null check (char_length(email) <= 150 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_number text not null check (contact_number ~ '^[0-9+\-\s]{7,20}$'),
  department     text not null,
  year_level     text not null,
  reason         text check (char_length(reason) <= 1000),
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_message  text check (char_length(admin_message) <= 1000),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index applications_open_email on public.membership_applications (lower(email))      where status in ('pending','approved');
create unique index applications_open_sid   on public.membership_applications (student_id)          where status in ('pending','approved');

-- =====================================================================
--  FUNCTIONS
-- =====================================================================

-- Is the current visitor an active admin? (used by every policy)
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

-- When someone signs up (Supabase Auth), create their profile. Role is ALWAYS 'member'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare short text := substr(replace(new.id::text, '-', ''), 1, 8);
begin
  insert into public.profiles (id, email, full_name, student_id, contact_number, department, year_level, username)
  values (new.id, new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'New Member'),
    coalesce(nullif(new.raw_user_meta_data->>'student_id', ''), 'U-' || short),
    coalesce(nullif(new.raw_user_meta_data->>'contact_number', ''), '0000000'),
    coalesce(nullif(new.raw_user_meta_data->>'department', ''), 'Not set'),
    coalesce(nullif(new.raw_user_meta_data->>'year_level', ''), '1st Year'),
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), 'user_' || short));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Members can edit their own profile but can NEVER change their own role/status/id.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.id := old.id; new.role := old.role; new.status := old.status; new.email := old.email;
  end if;
  return new;
end $$;
create trigger protect_profile_cols before update on public.profiles for each row execute function public.protect_profile();

-- Applications: visitors can only create 'pending' ones, and not if they already have an account / open application.
create or replace function public.prepare_application() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.status := 'pending'; new.admin_message := null; new.reviewed_at := null;
  end if;
  if tg_op = 'INSERT' then
    if exists (select 1 from public.profiles where lower(email) = lower(new.email) or student_id = new.student_id) then
      raise exception 'You already have an account. Please log in instead.';
    end if;
    if exists (select 1 from public.membership_applications where (lower(email) = lower(new.email) or student_id = new.student_id) and status in ('pending','approved')) then
      raise exception 'We already received an application with that email or Student ID.';
    end if;
  end if;
  return new;
end $$;
create trigger prepare_application_row before insert or update on public.membership_applications for each row execute function public.prepare_application();

-- Public numbers for the home page (no private data).
create or replace function public.public_stats() returns json
language sql security definer stable set search_path = public as $$
  select json_build_object(
    'members',         (select count(*) from public.profiles where role = 'member' and status = 'active'),
    'books',           (select count(*) from public.books),
    'plans',           (select count(*) from public.target_plans where status in ('planned','ongoing')),
    'accomplishments', (select count(*) from public.accomplishments where status = 'published'));
$$;

-- Applicant checks the result with BOTH email and Student ID.
create or replace function public.check_application(p_email text, p_student_id text)
returns table (full_name text, status text, admin_message text, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.full_name, a.status, a.admin_message, a.created_at from public.membership_applications a
  where lower(a.email) = lower(p_email) and a.student_id = p_student_id order by a.id desc limit 1;
$$;

-- Sign-up form: is the Student ID or username already used?
create or replace function public.registration_taken(p_student_id text, p_username text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where student_id = p_student_id or lower(username) = lower(p_username));
$$;

grant execute on function public.is_admin(), public.public_stats(), public.check_application(text, text), public.registration_taken(text, text) to anon, authenticated;

-- =====================================================================
--  ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles                enable row level security;
alter table public.books                   enable row level security;
alter table public.announcements           enable row level security;
alter table public.target_plans            enable row level security;
alter table public.accomplishments         enable row level security;
alter table public.officers                enable row level security;
alter table public.activity_albums         enable row level security;
alter table public.activity_photos         enable row level security;
alter table public.membership_applications enable row level security;

-- Public content: everyone reads, only admins write.
do $$ declare t text; begin
  foreach t in array array['books','target_plans','officers','activity_albums','activity_photos'] loop
    execute format('create policy "public read" on public.%I for select using (true)', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  foreach t in array array['announcements','accomplishments'] loop
    execute format('create policy "public read published" on public.%I for select using (status = ''published'' or public.is_admin())', t);
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Profiles: you see/edit yourself; admins see/edit everyone (role/status protected by trigger above).
create policy "read own or admin"   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "update own or admin" on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "admin delete"        on public.profiles for delete to authenticated using (public.is_admin());

-- Applications: anyone can apply; only admins read/review.
create policy "anyone can apply" on public.membership_applications for insert to anon, authenticated with check (true);
create policy "admin read"       on public.membership_applications for select to authenticated using (public.is_admin());
create policy "admin update"     on public.membership_applications for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete"     on public.membership_applications for delete to authenticated using (public.is_admin());

-- Table privileges (RLS above still decides what is actually allowed).
grant select on public.books, public.target_plans, public.officers, public.activity_albums, public.activity_photos, public.announcements, public.accomplishments to anon, authenticated;
grant insert, update, delete on public.books, public.target_plans, public.officers, public.activity_albums, public.activity_photos, public.announcements, public.accomplishments to authenticated;
grant select, update, delete on public.profiles to authenticated;
grant insert on public.membership_applications to anon, authenticated;
grant select, update, delete on public.membership_applications to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- =====================================================================
--  STORAGE: one public bucket "uploads" (covers, photos, PDFs). Only admins can write.
--  Size/type limits are enforced by Supabase itself.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

create policy "admin upload" on storage.objects for insert to authenticated with check (bucket_id = 'uploads' and public.is_admin());
create policy "admin update" on storage.objects for update to authenticated using (bucket_id = 'uploads' and public.is_admin());
create policy "admin delete" on storage.objects for delete to authenticated using (bucket_id = 'uploads' and public.is_admin());

-- =====================================================================
--  SAMPLE DATA (optional - delete this section if you want an empty site)
-- =====================================================================
insert into public.books (isbn, title, author, category, publisher, publication_year, description, quantity, available_copies, status) values
('9780060935467','To Kill a Mockingbird','Harper Lee','Fiction','HarperCollins',1960,'A young girl in the American South learns about justice and compassion through her father''s defense of a wrongly accused man.',3,3,'available'),
('9780143127741','Noli Me Tangere','Jose Rizal','Literature','Penguin Classics',1887,'Rizal''s landmark novel exposing the abuses of colonial Philippines.',5,4,'available'),
('9780143128571','El Filibusterismo','Jose Rizal','Literature','Penguin Classics',1891,'The sequel to Noli Me Tangere, darker and more revolutionary in tone.',4,0,'borrowed'),
('9780735211292','Atomic Habits','James Clear','Non-Fiction','Avery',2018,'A practical guide to building good habits and breaking bad ones.',2,1,'available'),
('9780132350884','Clean Code','Robert C. Martin','Technology','Prentice Hall',2008,'A handbook of agile software craftsmanship.',2,0,'reserved'),
('9780198788607','Pedagogy of the Oppressed','Paulo Freire','Education','Bloomsbury',1970,'A foundational text on critical pedagogy.',2,2,'available'),
('9780553380163','A Brief History of Time','Stephen Hawking','Science','Bantam',1988,'From the Big Bang to black holes, explained for the general reader.',3,3,'available'),
('9780385537858','Sapiens: A Brief History of Humankind','Yuval Noah Harari','History','Harper',2015,'A sweeping history of the human species.',3,2,'available'),
('9780199535569','Oxford Dictionary of English','Oxford University Press','Reference','Oxford University Press',2010,'Comprehensive reference dictionary (library use only).',1,1,'available'),
('9780061120084','The Alchemist','Paulo Coelho','Fiction','HarperOne',1988,'A shepherd boy follows his dream across the desert to find his Personal Legend.',4,4,'available');

insert into public.announcements (title, content, category, announcement_date, posted_by_name, status) values
('Book Week Celebration Schedule Released','Book Week is almost here! Join us for storytelling, a literary quiz bee, a book fair and a poetry night. Schedule and venue details are available at the PAHINA table in the library.','Event','2026-10-12','PAHINA Administrator','published'),
('New Books Added to the Library','We have added 10 new titles in Fiction, Science and Technology. Visit the Books page to browse them.','Library Update','2026-10-08','PAHINA Administrator','published'),
('Membership Renewal Reminder','Please make sure your profile information is up to date and your account is active before the end of the semester.','Important','2026-10-05','PAHINA Administrator','published'),
('Welcome to the New Academic Year!','PAHINA welcomes all new and returning members. Read. Relate. Revel.','Organization News','2026-08-20','PAHINA Administrator','published');

insert into public.target_plans (title, objective, description, target_date, responsible_person, status, progress) values
('Book Week Celebration','Promote reading culture through a week-long school celebration.','Storytelling, Literary Quiz Bee, Book Fair, Poetry Night and a Book Donation Drive.','2026-11-26','PAHINA Events Committee','ongoing',60),
('Library Digitization Project','Create a searchable digital catalog of all books in the library.','Encode all titles, assign categories and upload book covers to the library system.','2026-12-15','Library Committee','ongoing',35),
('Reading Marathon','Encourage members to read at least 3 books this semester.','Members log books read; top readers receive certificates and book prizes.','2026-12-01','Membership Committee','planned',10),
('Book Donation Drive','Collect 100 donated books for the club library.','Donation boxes placed in each college; thank-you event for donors.','2026-09-30','Outreach Team','completed',100);

insert into public.accomplishments (title, activity_name, description, accomplishments, participants, results, report_date, status) values
('Library Orientation Report','Library Orientation for Freshmen','Orientation on how to use the library system, borrow books and join PAHINA.','Introduced the library to all incoming freshmen and registered new members.','120 freshmen, 8 PAHINA officers, 2 faculty advisers','85 new members registered; 100% of attendees completed the evaluation form.','2026-09-10','published'),
('Storytelling Session Report','Storytelling for Young Readers','A storytelling activity with the nearby elementary school.','Read three children''s books aloud and donated 30 books to the school library.','45 pupils, 12 PAHINA volunteers','Pupils reported high enjoyment; the partner school asked for a monthly session.','2026-08-25','published'),
('Poetry Night Report','Poetry Night 2026','An evening of original poems and spoken word.','Successfully held the first Poetry Night with open-mic performances.','60 attendees, 15 performers','Compiled the best poems for the club zine.','2026-07-18','published');

-- =====================================================================
--  AFTER YOU REGISTER YOUR OWN ACCOUNT ON THE SITE, make yourself the admin:
--    update public.profiles set role = 'admin' where email = 'you@example.com';
-- =====================================================================
