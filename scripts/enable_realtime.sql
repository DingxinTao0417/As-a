-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable Realtime for conversations table  
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- Enable Realtime for orders table
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
