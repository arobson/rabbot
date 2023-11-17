FROM rabbitmq:3.13-rc-management-alpine

RUN rabbitmq-plugins enable --offline rabbitmq_consistent_hash_exchange
