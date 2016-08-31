FROM rabbitmq:3-management

RUN rabbitmq-plugins enable --offline rabbitmq_consistent_hash_exchange
