# Fin Flow - Makefile

.PHONY: start stop logs clean backup restore

start:
	docker-compose up -d --build

stop:
	docker-compose down

logs:
	docker-compose logs -f

clean:
	docker-compose down -v --rmi all

backup:
	@mkdir -p backups
	docker exec finflow-mongo mongodump --db finflow --archive=/tmp/backup.archive
	docker cp finflow-mongo:/tmp/backup.archive ./backups/finflow-$$(date +%Y%m%d-%H%M%S).archive
	@echo "Backup saved to ./backups/"

restore:
	@if [ -z "$(FILE)" ]; then echo "Usage: make restore FILE=backups/filename.archive"; exit 1; fi
	docker cp $(FILE) finflow-mongo:/tmp/restore.archive
	docker exec finflow-mongo mongorestore --db finflow --archive=/tmp/restore.archive --drop
	@echo "Restored from $(FILE)"
