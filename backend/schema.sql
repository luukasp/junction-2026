-- Generated from app/models.py for MariaDB 11.4.
-- Select/create your database before applying this schema.



CREATE TABLE cancer_outcomes (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	area_code VARCHAR(10), 
	table_id VARCHAR(100) NOT NULL, 
	source_row INTEGER NOT NULL, 
	source_url TEXT NOT NULL, 
	cancer VARCHAR(100) NOT NULL, 
	sex VARCHAR(100) NOT NULL, 
	area VARCHAR(100) NOT NULL, 
	area_level VARCHAR(100) NOT NULL, 
	collaboration_area VARCHAR(100) NOT NULL, 
	incidence_period VARCHAR(100) NOT NULL, 
	survival_diagnosis_period VARCHAR(100) NOT NULL, 
	survival_followup_through DATE NOT NULL, 
	survival_method TEXT NOT NULL, 
	prevalence_definition TEXT NOT NULL, 
	incidence_n FLOAT, 
	prevalence_n FLOAT, 
	mortality_n FLOAT, 
	incidence_rate FLOAT, 
	incidence_rate_ci_lower FLOAT, 
	incidence_rate_ci_upper FLOAT, 
	incidence_rate_raw TEXT, 
	relative_survival_5y_pct FLOAT, 
	relative_survival_5y_pct_ci_lower FLOAT, 
	relative_survival_5y_pct_ci_upper FLOAT, 
	relative_survival_5y_pct_raw TEXT, 
	mortality_rate FLOAT, 
	mortality_rate_ci_lower FLOAT, 
	mortality_rate_ci_upper FLOAT, 
	mortality_rate_raw TEXT, 
	CONSTRAINT pk_cancer_outcomes PRIMARY KEY (id), 
	CONSTRAINT uq_cancer_outcomes_table_id UNIQUE (table_id, source_row)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;

CREATE INDEX ix_cancer_outcomes_area_code ON cancer_outcomes (area_code);

CREATE INDEX ix_outcomes_cancer_sex ON cancer_outcomes (cancer, sex);


CREATE TABLE ingestion_state (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	fingerprint VARCHAR(64) NOT NULL, 
	imported_at DATETIME NOT NULL, 
	manifest JSON NOT NULL, 
	row_counts JSON NOT NULL, 
	CONSTRAINT pk_ingestion_state PRIMARY KEY (id)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;


CREATE TABLE lung_treatments (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	area_code VARCHAR(10), 
	table_id VARCHAR(100) NOT NULL, 
	source_row INTEGER NOT NULL, 
	source_url TEXT NOT NULL, 
	area_fi VARCHAR(100) NOT NULL, 
	collaboration_area_fi VARCHAR(100) NOT NULL, 
	treatment_type_fi VARCHAR(100) NOT NULL, 
	diagnosis_period VARCHAR(100) NOT NULL, 
	treatment_n FLOAT, 
	patients_n FLOAT, 
	share_pct FLOAT, 
	observation_window TEXT NOT NULL, 
	warning TEXT NOT NULL, 
	CONSTRAINT pk_lung_treatments PRIMARY KEY (id), 
	CONSTRAINT uq_lung_treatments_table_id UNIQUE (table_id, source_row)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;

CREATE INDEX ix_lung_treatments_area_code ON lung_treatments (area_code);


CREATE TABLE regions (
	area_code VARCHAR(10) NOT NULL, 
	area_name_en VARCHAR(100) NOT NULL, 
	area_name_fi VARCHAR(100) NOT NULL, 
	screening_mainland_coverage BOOL NOT NULL, 
	source_url TEXT NOT NULL, 
	geography_reference DATE NOT NULL, 
	CONSTRAINT pk_regions PRIMARY KEY (area_code)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;


CREATE TABLE screening_observations (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	program VARCHAR(30) NOT NULL, 
	year INTEGER NOT NULL, 
	section TEXT NOT NULL, 
	dimensions JSON NOT NULL, 
	metric VARCHAR(255) NOT NULL, 
	value FLOAT, 
	value_raw TEXT NOT NULL, 
	table_id VARCHAR(100) NOT NULL, 
	source_row INTEGER NOT NULL, 
	source_url TEXT NOT NULL, 
	area_code VARCHAR(10), 
	area VARCHAR(100), 
	county_section TEXT, 
	strata JSON, 
	unit VARCHAR(30), 
	CONSTRAINT pk_screening_observations PRIMARY KEY (id), 
	CONSTRAINT uq_screening_observations_table_id UNIQUE (table_id, source_row, metric)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;

CREATE INDEX ix_screening_county_year_program ON screening_observations (area_code, year, program);

CREATE INDEX ix_screening_observations_area_code ON screening_observations (area_code);

CREATE INDEX ix_screening_program_year ON screening_observations (program, year);


CREATE TABLE source_tables (
	table_id VARCHAR(100) NOT NULL, 
	headers JSON NOT NULL, 
	catalog JSON NOT NULL, 
	CONSTRAINT pk_source_tables PRIMARY KEY (table_id)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;


CREATE TABLE statfin_observations (
	id INTEGER NOT NULL AUTO_INCREMENT, 
	dataset VARCHAR(20) NOT NULL, 
	year INTEGER NOT NULL, 
	metric_code VARCHAR(100) NOT NULL, 
	metric_label TEXT NOT NULL, 
	dimensions JSON NOT NULL, 
	dimension_key VARCHAR(64) NOT NULL, 
	area_code VARCHAR(20), 
	area_label VARCHAR(100), 
	sex_code VARCHAR(20), 
	sex_label VARCHAR(100), 
	cause_code VARCHAR(30), 
	cause_label VARCHAR(255), 
	value FLOAT, 
	value_raw TEXT NOT NULL, 
	status VARCHAR(50) NOT NULL, 
	source_url TEXT NOT NULL, 
	CONSTRAINT pk_statfin_observations PRIMARY KEY (id), 
	CONSTRAINT uq_statfin_observations_dataset UNIQUE (dataset, year, metric_code, dimension_key)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;

CREATE INDEX ix_statfin_county_dataset_metric_year ON statfin_observations (area_code, dataset, metric_code, year);

CREATE INDEX ix_statfin_dataset_year ON statfin_observations (dataset, year);

CREATE INDEX ix_statfin_observations_area_code ON statfin_observations (area_code);


CREATE TABLE source_rows (
	table_id VARCHAR(100) NOT NULL, 
	source_row INTEGER NOT NULL, 
	cells JSON NOT NULL, 
	CONSTRAINT pk_source_rows PRIMARY KEY (table_id, source_row), 
	CONSTRAINT fk_source_rows_table_id_source_tables FOREIGN KEY(table_id) REFERENCES source_tables (table_id)
)ENGINE=InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_bin

;
