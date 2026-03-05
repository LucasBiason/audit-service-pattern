.PHONY: install dev up down logs clean

install:
	npm install

dev:
	npm run dev

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f audit-service

clean:
	docker compose down -v
	rm -rf dist node_modules
