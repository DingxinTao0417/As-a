-- Delete any services/providers created by users with seeker role
-- First, find all user_ids that are seekers
-- Then delete their provider profiles

-- Delete providers that belong to users with seeker role
DELETE FROM public.providers 
WHERE user_id IN (
  SELECT id FROM public.profiles WHERE role = 'seeker'
);

-- Delete any conversations where the provider_id doesn't exist in providers table
DELETE FROM public.conversations
WHERE provider_id NOT IN (SELECT id FROM public.providers);

-- Delete any orders where the provider doesn't exist
DELETE FROM public.orders
WHERE provider_id NOT IN (SELECT id FROM public.providers);

-- Delete any service_history entries where provider doesn't exist  
DELETE FROM public.service_history
WHERE provider_id NOT IN (SELECT id FROM public.providers);

-- Add a check constraint to ensure conversations only reference valid providers
-- (provider_id must exist in providers table - this is already handled by foreign key)

-- Log the cleanup results
SELECT 'Cleanup completed' as status;
