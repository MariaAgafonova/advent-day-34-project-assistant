INSERT OR IGNORE INTO customers VALUES ('demo-auth','Учебный клиент А','ru','Android','1.0-demo',1760000000000);
INSERT OR IGNORE INTO customers VALUES ('demo-notifications','Учебный клиент Б','ru','Android','1.0-demo',1760000000000);
INSERT OR IGNORE INTO tickets (id,customer_id,subject,status,created_at,updated_at) VALUES
 ('demo-auth-ticket','demo-auth','Не приходит email-код','waiting_for_customer',1760000000000,1760000000002),
 ('demo-notifications-ticket','demo-notifications','Не приходит вечернее напоминание','open',1760000000000,1760000000002);
INSERT OR IGNORE INTO messages (id,ticket_id,role,content,processing_status,created_at) VALUES
 ('seed-auth-user','demo-auth-ticket','user','Не приходит письмо для входа. Адрес проверил, папку Спам уже проверил — письма нет.','complete',1760000000001),
 ('seed-auth-assistant','demo-auth-ticket','assistant','Понятно, адрес и Спам уже проверены. Сколько времени прошло с последнего запроса письма? Сам код не присылайте.','complete',1760000000002),
 ('seed-notifications-user','demo-notifications-ticket','user','Вечернее напоминание не приходит. В настройках Daily Tasks оно включено, уведомления Android разрешены.','complete',1760000000001);
