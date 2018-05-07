all:
	trap 'kill %1' SIGINT; make run & make run-internal

split: 
	tmux new-session 'make run' \; split-window 'make run-internal' \;

install:
	npm i

build:
	npm run build

run:
	npm run start

run-internal:
	npm run start-internal

test:
	npm run transpile
	npm run transpile-tests
	npm test

test-system:
	npm run test-system

db:
	rm -f database.sqlite
	npm run create-db

db-prod: db
	chown -R ubuntu:www-data .


.PHONY: test run build install

revision := $(shell git rev-parse --short HEAD)
image := "kinecosystem/marketplace-server"

build-image:
	docker build -t ${image} -f Dockerfile \
		--build-arg BUILD_COMMIT="${revision}" \
		--build-arg BUILD_TIMESTAMP="$(shell date -u +"%Y-%m-%dT%H:%M:%SZ")" .
	docker tag ${image} ${image}:${revision}

push-image:
	docker push ${image}:latest
	docker push ${image}:${revision}

up:
	docker-compose -f docker-compose.yaml -f deps.yaml up

down:
	docker-compose -f docker-compose.yaml -f deps.yaml down

psql:
	docker-compose -f docker-compose.yaml -f deps.yaml -f tests.yaml run --rm psql

db-docker:
	docker-compose -f docker-compose.yaml -f deps.yaml -f tests.yaml run --rm psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
	docker-compose -f docker-compose.yaml -f deps.yaml -f tests.yaml run --rm create-db

test-system-docker: db-docker
	docker-compose -f docker-compose.yaml -f deps.yaml -f tests.yaml run --rm test-system
