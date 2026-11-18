// Crew name kit per nationality, and the crew mix hired at each home base.
// First names are [female, male] lists so generated crews are mixed.
// namesWorld.ts adds a kit for every other country a client can come from (the phone call's caller).

import { CALLER_KITS, WORLD_NAMES } from './namesWorld';

export interface NameKit {
  f: string[];
  m: string[];
  last: string[];
  /** Feminine surname forms, index-aligned with `last` (Baltic, Slavic). */
  lastF?: string[];
  /** Working languages beyond English. */
  langs: string[];
  /** Said family name first ('Nguyễn Lan', 'Kim Ji-woo'). */
  familyFirst?: boolean;
}

const CREW_NAMES: Record<string, NameKit> = {
  PT: {
    f: ['Ana', 'Beatriz', 'Catarina', 'Inês', 'Joana', 'Mariana', 'Rita', 'Sofia', 'Teresa', 'Leonor', 'Carolina', 'Marta'],
    m: ['António', 'Bruno', 'Diogo', 'Duarte', 'Francisco', 'João', 'Miguel', 'Nuno', 'Pedro', 'Rui', 'Tiago', 'Vasco'],
    last: ['Almeida', 'Carvalho', 'Costa', 'Ferreira', 'Gomes', 'Lopes', 'Marques', 'Martins', 'Mendes', 'Oliveira', 'Pereira', 'Ribeiro', 'Rodrigues', 'Santos', 'Silva', 'Sousa', 'Teixeira', 'Vieira'],
    langs: ['pt', 'es'],
  },
  BR: {
    f: ['Camila', 'Fernanda', 'Gabriela', 'Juliana', 'Larissa', 'Luana', 'Patrícia', 'Renata'],
    m: ['Caio', 'Felipe', 'Gustavo', 'Henrique', 'Lucas', 'Mateus', 'Rafael', 'Thiago'],
    last: ['Barbosa', 'Cardoso', 'Castro', 'Moreira', 'Nascimento', 'Pinto', 'Rocha', 'Souza'],
    langs: ['pt'],
  },
  ES: {
    f: ['Alba', 'Carmen', 'Elena', 'Irene', 'Lucía', 'María', 'Nerea', 'Paula', 'Raquel', 'Sara'],
    m: ['Álvaro', 'Carlos', 'David', 'Javier', 'Jorge', 'Manuel', 'Pablo', 'Sergio', 'Daniel', 'Iker'],
    last: ['Díaz', 'Fernández', 'García', 'González', 'Hernández', 'López', 'Martín', 'Moreno', 'Navarro', 'Pérez', 'Ruiz', 'Sánchez', 'Torres', 'Vidal'],
    langs: ['es'],
  },
  LT: {
    f: ['Agnė', 'Eglė', 'Gabija', 'Ieva', 'Indrė', 'Justė', 'Rūta', 'Simona', 'Vaida', 'Laura'],
    m: ['Andrius', 'Darius', 'Domantas', 'Jonas', 'Karolis', 'Lukas', 'Mantas', 'Paulius', 'Tomas', 'Vytautas'],
    last: ['Bielskis', 'Jankauskas', 'Kazlauskas', 'Petrauskas', 'Stankevičius', 'Vasiliauskas', 'Žukauskas', 'Butkus', 'Paulauskas', 'Urbonas'],
    lastF: ['Bielskytė', 'Jankauskaitė', 'Kazlauskaitė', 'Petrauskaitė', 'Stankevičiūtė', 'Vasiliauskaitė', 'Žukauskaitė', 'Butkutė', 'Paulauskaitė', 'Urbonaitė'],
    langs: ['lt', 'ru'],
  },
  LV: {
    f: ['Anna', 'Elīna', 'Ilze', 'Kristīne', 'Laura', 'Līga', 'Sanita', 'Zane'],
    m: ['Artūrs', 'Edgars', 'Jānis', 'Kārlis', 'Mārtiņš', 'Raivis', 'Roberts', 'Valdis'],
    last: ['Bērziņš', 'Kalniņš', 'Ozoliņš', 'Krūmiņš', 'Liepa', 'Ozols', 'Vītols', 'Zariņš'],
    lastF: ['Bērziņa', 'Kalniņa', 'Ozoliņa', 'Krūmiņa', 'Liepa', 'Ozola', 'Vītola', 'Zariņa'],
    langs: ['lv', 'ru'],
  },
  MT: {
    f: ['Claire', 'Elaine', 'Maria', 'Rachel', 'Roberta', 'Stephanie', 'Yanica', 'Nicole', 'Rebecca', 'Christine', 'Daniela', 'Graziella', 'Josette', 'Kimberley', 'Martina', 'Miriam', 'Sarah', 'Shirley', 'Simona', 'Tiziana'],
    m: ['Clayton', 'Daniel', 'Joseph', 'Kurt', 'Luke', 'Matthew', 'Neil', 'Ryan', 'Andrew', 'Christian', 'David', 'Glenn', 'Jean', 'Karl', 'Mark', 'Nathan', 'Owen', 'Reuben', 'Shaun', 'Steve'],
    last: ['Abela', 'Azzopardi', 'Borg', 'Camilleri', 'Caruana', 'Farrugia', 'Galea', 'Grech', 'Vella', 'Zammit', 'Agius', 'Attard', 'Bonello', 'Buttigieg', 'Cassar', 'Debono', 'Fenech', 'Micallef', 'Mifsud', 'Pace', 'Sammut', 'Spiteri'],
    langs: ['mt', 'it'],
  },
  IT: {
    f: ['Chiara', 'Francesca', 'Giulia', 'Martina', 'Sara', 'Valentina', 'Alessia', 'Alice', 'Anna', 'Elisa', 'Federica', 'Giorgia', 'Ilaria', 'Laura', 'Lucia', 'Paola', 'Roberta', 'Serena', 'Silvia', 'Veronica'],
    m: ['Alessandro', 'Davide', 'Luca', 'Marco', 'Matteo', 'Stefano', 'Andrea', 'Antonio', 'Fabio', 'Federico', 'Francesco', 'Giorgio', 'Giuseppe', 'Lorenzo', 'Massimo', 'Nicola', 'Paolo', 'Riccardo', 'Roberto', 'Simone'],
    last: ['Bianchi', 'Colombo', 'Esposito', 'Ferrari', 'Ricci', 'Romano', 'Rossi', 'Russo', 'Barbieri', 'Bruno', 'Conti', 'Costa', 'De Luca', 'Fontana', 'Gallo', 'Giordano', 'Greco', 'Lombardi', 'Mancini', 'Marino', 'Moretti', 'Rinaldi'],
    langs: ['it'],
  },
  RO: {
    f: ['Andreea', 'Elena', 'Ioana', 'Maria', 'Raluca', 'Simona', 'Alexandra', 'Bianca', 'Cristina', 'Diana', 'Gabriela', 'Irina', 'Larisa', 'Mădălina', 'Mihaela', 'Oana', 'Roxana', 'Alina', 'Camelia', 'Corina'],
    m: ['Adrian', 'Andrei', 'Bogdan', 'Cristian', 'Mihai', 'Radu', 'Alexandru', 'Cătălin', 'Ciprian', 'Daniel', 'Florin', 'George', 'Ionuț', 'Marius', 'Ovidiu', 'Răzvan', 'Sorin', 'Ștefan', 'Vlad', 'Victor'],
    last: ['Constantin', 'Dumitru', 'Ionescu', 'Popa', 'Popescu', 'Stan', 'Stoica', 'Gheorghe', 'Rusu', 'Munteanu', 'Matei', 'Ciobanu', 'Ene', 'Moldovan', 'Lazăr', 'Marin', 'Florea', 'Dobre', 'Barbu', 'Nistor'],
    langs: ['ro'],
  },
  PL: {
    f: ['Agnieszka', 'Joanna', 'Katarzyna', 'Magdalena', 'Natalia', 'Zofia', 'Aleksandra', 'Anna', 'Ewa', 'Karolina', 'Marta', 'Monika', 'Paulina', 'Weronika', 'Julia', 'Dominika', 'Justyna', 'Kinga', 'Martyna', 'Sylwia'],
    m: ['Jakub', 'Kamil', 'Marcin', 'Michał', 'Piotr', 'Tomasz', 'Adam', 'Bartosz', 'Damian', 'Grzegorz', 'Krzysztof', 'Łukasz', 'Maciej', 'Mateusz', 'Paweł', 'Rafał', 'Sebastian', 'Szymon', 'Wojciech', 'Dawid'],
    last: ['Kowalczyk', 'Kowalski', 'Lewandowski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Zieliński', 'Kamiński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Kwiatkowski', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Pawłowski', 'Michalski'],
    lastF: ['Kowalczyk', 'Kowalska', 'Lewandowska', 'Nowak', 'Wiśniewska', 'Wójcik', 'Zielińska', 'Kamińska', 'Szymańska', 'Woźniak', 'Dąbrowska', 'Kozłowska', 'Jankowska', 'Mazur', 'Kwiatkowska', 'Krawczyk', 'Piotrowska', 'Grabowska', 'Pawłowska', 'Michalska'],
    langs: ['pl'],
  },
  GB: {
    f: ['Charlotte', 'Emily', 'Hannah', 'Lucy', 'Olivia', 'Sophie', 'Amy', 'Chloe', 'Eleanor', 'Emma', 'Georgia', 'Jessica', 'Katie', 'Laura', 'Megan', 'Rebecca', 'Rachel', 'Sarah', 'Zoe', 'Abigail'],
    m: ['Ben', 'Callum', 'George', 'James', 'Oliver', 'Tom', 'Adam', 'Alex', 'Chris', 'Daniel', 'Harry', 'Jack', 'Joe', 'Luke', 'Matt', 'Nathan', 'Rob', 'Sam', 'Will', 'Ryan'],
    last: ['Clarke', 'Evans', 'Hughes', 'Jones', 'Smith', 'Taylor', 'Walker', 'Wright', 'Brown', 'Davies', 'Edwards', 'Green', 'Hall', 'Harris', 'Jackson', 'Johnson', 'Roberts', 'Thomas', 'Thompson', 'Turner', 'White', 'Wilson'],
    langs: [],
  },
  FR: {
    f: ['Camille', 'Chloé', 'Léa', 'Manon', 'Inès', 'Sarah', 'Amandine', 'Anaïs', 'Audrey', 'Céline', 'Claire', 'Élodie', 'Émilie', 'Julie', 'Laura', 'Marion', 'Mathilde', 'Pauline', 'Sophie', 'Charlotte'],
    m: ['Antoine', 'Hugo', 'Julien', 'Louis', 'Mathieu', 'Nicolas', 'Alexandre', 'Baptiste', 'Benoît', 'Clément', 'Damien', 'Florian', 'Guillaume', 'Jérôme', 'Kevin', 'Maxime', 'Pierre', 'Romain', 'Sébastien', 'Thomas'],
    last: ['Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Martin', 'Moreau', 'Petit', 'Richard', 'Bertrand', 'Blanc', 'David', 'Fontaine', 'Fournier', 'Garnier', 'Girard', 'Lambert', 'Laurent', 'Leroy', 'Mercier', 'Michel', 'Roux', 'Simon'],
    langs: ['fr'],
  },
  CZ: {
    f: ['Tereza', 'Kateřina', 'Lucie', 'Veronika', 'Petra', 'Barbora', 'Markéta', 'Klára'],
    m: ['Jakub', 'Jan', 'Tomáš', 'Martin', 'Ondřej', 'Lukáš', 'Petr', 'Vojtěch'],
    last: ['Novák', 'Svoboda', 'Novotný', 'Dvořák', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Němec'],
    lastF: ['Nováková', 'Svobodová', 'Novotná', 'Dvořáková', 'Černá', 'Procházková', 'Kučerová', 'Veselá', 'Horáková', 'Němcová'],
    langs: ['cs', 'sk'],
  },
  SK: {
    f: ['Zuzana', 'Jana', 'Simona', 'Lenka', 'Michaela', 'Dominika', 'Andrea', 'Barbora', 'Eva', 'Ivana', 'Katarína', 'Kristína', 'Lucia', 'Martina', 'Monika', 'Natália', 'Petra', 'Silvia', 'Veronika', 'Nikola'],
    m: ['Marek', 'Peter', 'Michal', 'Juraj', 'Matej', 'Martin', 'Adam', 'Andrej', 'Branislav', 'Dávid', 'Filip', 'Ján', 'Jakub', 'Lukáš', 'Milan', 'Miroslav', 'Patrik', 'Roman', 'Tomáš', 'Vladimír'],
    last: ['Horváth', 'Kováč', 'Varga', 'Tóth', 'Nagy', 'Baláž', 'Szabó', 'Molnár', 'Lukáč', 'Novák', 'Polák', 'Kollár', 'Blaško', 'Kráľ', 'Hudák', 'Németh', 'Gajdoš', 'Bartoš', 'Šimko', 'Mikuláš'],
    lastF: ['Horváthová', 'Kováčová', 'Vargová', 'Tóthová', 'Nagyová', 'Balážová', 'Szabóová', 'Molnárová', 'Lukáčová', 'Nováková', 'Poláková', 'Kollárová', 'Blašková', 'Kráľová', 'Hudáková', 'Némethová', 'Gajdošová', 'Bartošová', 'Šimková', 'Mikulášová'],
    langs: ['sk', 'cs'],
  },
  BG: {
    f: ['Maria', 'Ivana', 'Elena', 'Desislava', 'Gergana', 'Viktoria', 'Teodora', 'Nikol'],
    m: ['Georgi', 'Ivan', 'Dimitar', 'Nikolay', 'Hristo', 'Stoyan', 'Martin', 'Petar'],
    last: ['Ivanov', 'Georgiev', 'Dimitrov', 'Petrov', 'Nikolov', 'Hristov', 'Stoyanov', 'Todorov', 'Iliev', 'Angelov'],
    lastF: ['Ivanova', 'Georgieva', 'Dimitrova', 'Petrova', 'Nikolova', 'Hristova', 'Stoyanova', 'Todorova', 'Ilieva', 'Angelova'],
    langs: ['bg', 'ru'],
  },
  EE: {
    f: ['Kadri', 'Liis', 'Maarja', 'Kristiina', 'Triin', 'Kertu', 'Getter', 'Anu'],
    m: ['Martin', 'Rasmus', 'Andres', 'Siim', 'Kristjan', 'Mart', 'Tanel', 'Priit'],
    last: ['Tamm', 'Saar', 'Sepp', 'Mägi', 'Kask', 'Kukk', 'Rebane', 'Ilves', 'Pärn', 'Koppel'],
    langs: ['et', 'ru', 'fi'],
  },
  CV: {
    f: ['Djamila', 'Elisa', 'Ilda', 'Nádia', 'Adilsa', 'Carla', 'Celeste', 'Denise', 'Edna', 'Elsa', 'Ivone', 'Jacira', 'Liliana', 'Maura', 'Natália', 'Odete', 'Paula', 'Rosa', 'Sónia', 'Zenaida'],
    m: ['Amílcar', 'Hélder', 'Nelson', 'Válter', 'Adilson', 'Alcides', 'Arlindo', 'Carlos', 'Edson', 'Emanuel', 'Hernâni', 'Jailson', 'José', 'Manuel', 'Mário', 'Osvaldo', 'Paulo', 'Ricardo', 'Silvino', 'Ulisses'],
    last: ['Fortes', 'Lima', 'Monteiro', 'Semedo', 'Tavares', 'Varela', 'Almeida', 'Andrade', 'Barros', 'Brito', 'Delgado', 'Évora', 'Gomes', 'Lopes', 'Mendes', 'Moreno', 'Pires', 'Ramos', 'Rodrigues', 'Silva'],
    langs: ['pt', 'fr'],
  },
};

/** Every name kit: the crew kits first (PT stays the first one), then the world's. */
export const NAMES: Record<string, NameKit> = { ...CREW_NAMES, ...WORLD_NAMES };

/** The kits a country's people are named from (Belgium: Dutch and French…); [] when the country has none. */
export function kitsFor(country: string): string[] {
  return CALLER_KITS[country] ?? (NAMES[country] ? [country] : []);
}

/** Nationality weights for crew hired at a home base (by base country). */
export const CREW_MIX: Record<string, [string, number][]> = {
  PT: [['PT', 0.72], ['BR', 0.1], ['ES', 0.08], ['CV', 0.05], ['FR', 0.05]],
  ES: [['ES', 0.75], ['PT', 0.08], ['IT', 0.07], ['FR', 0.05], ['RO', 0.05]],
  LT: [['LT', 0.6], ['LV', 0.12], ['PL', 0.12], ['GB', 0.06], ['ES', 0.05], ['IT', 0.05]],
  LV: [['LV', 0.6], ['LT', 0.15], ['PL', 0.1], ['RO', 0.05], ['GB', 0.05], ['IT', 0.05]],
  CZ: [['CZ', 0.7], ['SK', 0.15], ['PL', 0.08], ['GB', 0.04], ['IT', 0.03]],
  BG: [['BG', 0.8], ['RO', 0.08], ['GB', 0.04], ['IT', 0.04], ['PL', 0.04]],
  EE: [['EE', 0.65], ['LV', 0.12], ['LT', 0.08], ['PL', 0.05], ['GB', 0.05], ['IT', 0.05]],
  MT: [['MT', 0.4], ['IT', 0.15], ['GB', 0.12], ['RO', 0.1], ['PL', 0.08], ['ES', 0.08], ['PT', 0.07]],
};

export const DEFAULT_MIX: [string, number][] = [['GB', 0.3], ['ES', 0.2], ['PT', 0.2], ['IT', 0.15], ['PL', 0.15]];
