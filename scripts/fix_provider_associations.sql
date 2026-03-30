-- Find providers without proper user association and list them
-- This helps debug which provider records are orphaned

-- Show all providers with their user_id status
SELECT 
  p.id as provider_id,
  p.user_id,
  p.name_en,
  pr.id as profile_id,
  pr.role as profile_role,
  pr.email as profile_email
FROM providers p
LEFT JOIN profiles pr ON p.user_id = pr.id;

-- Show users with role='provider' who don't have a provider record
SELECT 
  pr.id,
  pr.email,
  pr.full_name,
  pr.role
FROM profiles pr
WHERE pr.role = 'provider'
AND NOT EXISTS (
  SELECT 1 FROM providers p WHERE p.user_id = pr.id
);
