// Name kits for every country a client can come from (the phone call's caller, client contacts). Real common first
// and family names per country or language. The crew kits in names.ts stay as they are (crew generation is seeded on
// them); these are added on top. CALLER_KITS maps a country to the kits its people are drawn from (Belgium: Dutch and
// French; Switzerland: German, French, Italian; Canada: English and French…).

import type { NameKit } from './names';

const s = (x: string) => x.split(',').map((v) => v.trim());
/** kit(female, male, family, langs, feminine family forms?, family name first?) */
const kit = (f: string, m: string, last: string, langs: string[] = [], lastF?: string, familyFirst?: boolean): NameKit => ({
  f: s(f), m: s(m), last: s(last), langs, ...(lastF ? { lastF: s(lastF) } : {}), ...(familyFirst ? { familyFirst } : {}),
});

const GULF_F = 'Fatima, Mariam, Noura, Aisha, Hessa, Latifa, Reem, Shamma';
const GULF_M = 'Mohammed, Ahmed, Khalid, Saeed, Abdullah, Rashid, Hamad, Sultan';
const LATAM_F = 'María José, Daniela, Valentina, Gabriela, Carolina, Andrea, Paola, Natalia';
const LATAM_M = 'José Luis, Carlos, Andrés, Diego, Luis, Alejandro, Jorge, Ricardo';

export const WORLD_NAMES: Record<string, NameKit> = {
  // Europe
  DE: kit('Anna, Laura, Julia, Lena, Katharina, Sarah, Lisa, Hannah', 'Lukas, Jonas, Felix, Maximilian, Tobias, Jan, Florian, Stefan', 'Müller, Schmidt, Schneider, Fischer, Weber, Meyer, Wagner, Becker, Schulz, Hoffmann, Koch, Richter', ['de']),
  AT: kit('Anna, Lena, Sophie, Katharina, Julia, Sarah, Theresa, Magdalena', 'Lukas, Florian, Maximilian, David, Tobias, Stefan, Markus, Johannes', 'Gruber, Huber, Bauer, Wagner, Müller, Pichler, Steiner, Moser, Mayer, Hofer, Leitner, Berger', ['de']),
  'CH-de': kit('Anna, Laura, Sarah, Lea, Nina, Corinne, Sandra, Andrea', 'Lukas, Simon, Reto, Urs, Beat, Marco, Daniel, Thomas', 'Müller, Meier, Schmid, Keller, Weber, Huber, Schneider, Baumann, Brunner, Gerber, Frei, Moser', ['de', 'fr']),
  'CH-fr': kit('Camille, Léa, Chloé, Laure, Mélanie, Sophie, Nathalie, Aline', 'Nicolas, Julien, Olivier, Laurent, Pascal, Yves, Sébastien, Mathieu', 'Favre, Rochat, Bonvin, Pittet, Perrin, Jaquet, Rey, Morand, Golay, Chevalley, Dubois, Monnier', ['fr', 'de']),
  'CH-it': kit('Giulia, Chiara, Sara, Elena, Laura, Martina', 'Luca, Marco, Andrea, Matteo, Fabio, Davide', 'Bernasconi, Rossi, Ferrari, Pedrazzini, Lurati, Bianchi, Galli, Cattaneo, Fontana, Bernardi', ['it', 'de']),
  LU: kit('Anne, Claire, Laura, Michèle, Sandra, Carole, Lynn, Sophie', 'Marc, Luc, Paul, Tom, Jeff, Yves, Laurent, Ben', 'Schmit, Muller, Weber, Wagner, Hoffmann, Thill, Schmitz, Klein, Kremer, Reuter, Hansen, Faber', ['lb', 'fr', 'de']),
  NL: kit('Anouk, Sanne, Lisa, Emma, Femke, Eva, Iris, Marieke', 'Daan, Bram, Thijs, Lars, Jeroen, Sander, Ruben, Maarten', 'de Jong, Jansen, de Vries, van den Berg, van Dijk, Bakker, Visser, Smit, Meijer, de Boer, Mulder, Bos', ['nl']),
  'BE-nl': kit('Lotte, Anke, Sofie, Lien, Ellen, Katrien, Elke, Hanne', 'Wouter, Pieter, Jens, Bart, Koen, Stijn, Tom, Thomas', 'Peeters, Janssens, Maes, Jacobs, Mertens, Willems, Claes, Goossens, Wouters, De Smet, Vermeulen, Van Damme', ['nl', 'fr']),
  'BE-fr': kit('Camille, Julie, Aurélie, Céline, Charlotte, Marie, Pauline, Sophie', 'Nicolas, Julien, François, Maxime, Olivier, Benoît, Thomas, Antoine', 'Dubois, Lambert, Dupont, Martin, Simon, Laurent, Leclercq, Lejeune, Renard, François, Collard, Lemaire', ['fr', 'nl']),
  IE: kit('Aoife, Siobhán, Niamh, Ciara, Sinéad, Orla, Gráinne, Róisín', 'Cian, Conor, Seán, Darragh, Eoin, Ciarán, Oisín, Patrick', "Murphy, Kelly, O'Sullivan, Walsh, Byrne, Ryan, O'Brien, Doyle, McCarthy, Kennedy, Lynch, O'Connor"),
  GR: kit('Maria, Eleni, Katerina, Georgia, Sofia, Dimitra, Ioanna, Vasiliki', 'Giorgos, Dimitris, Konstantinos, Nikos, Yannis, Christos, Panagiotis, Kostas', 'Papadopoulos, Pappas, Georgiou, Nikolaidis, Oikonomou, Karagiannis, Vlachos, Antoniou, Dimitriou, Makris', ['el'], 'Papadopoulou, Pappa, Georgiou, Nikolaidou, Oikonomou, Karagianni, Vlachou, Antoniou, Dimitriou, Makri'),
  CY: kit('Maria, Eleni, Andri, Christina, Marina, Despina, Stella, Georgia', 'Andreas, Christos, Michalis, Marios, Kyriakos, Nikos, Panayiotis, Savvas', 'Georgiou, Constantinou, Charalambous, Ioannou, Christodoulou, Nicolaou, Panayiotou, Andreou, Michael, Kyriacou', ['el', 'tr']),
  DK: kit('Mette, Camilla, Sofie, Ida, Louise, Anne, Maria, Line', 'Mads, Rasmus, Frederik, Mikkel, Søren, Anders, Jesper, Christian', 'Nielsen, Jensen, Hansen, Pedersen, Andersen, Christensen, Larsen, Sørensen, Rasmussen, Jørgensen', ['da']),
  SE: kit('Anna, Emma, Sara, Johanna, Elin, Maja, Linnea, Karin', 'Erik, Johan, Anders, Oskar, Viktor, Gustav, Fredrik, Henrik', 'Andersson, Johansson, Karlsson, Nilsson, Eriksson, Larsson, Olsson, Persson, Svensson, Lindberg', ['sv']),
  NO: kit('Ingrid, Kari, Silje, Ida, Ingeborg, Marte, Hanne, Nora', 'Ole, Lars, Magnus, Henrik, Jonas, Eirik, Kristian, Sindre', 'Hansen, Johansen, Olsen, Larsen, Andersen, Pedersen, Nilsen, Kristiansen, Berg, Haugen', ['no']),
  FI: kit('Aino, Laura, Emilia, Johanna, Kaisa, Sanna, Riikka, Heidi', 'Mikko, Juha, Antti, Ville, Janne, Matti, Lauri, Timo', 'Korhonen, Virtanen, Mäkinen, Nieminen, Mäkelä, Hämäläinen, Laine, Heikkinen, Koskinen, Järvinen', ['fi', 'sv']),
  IS: kit('Guðrún, Sigríður, Anna, Kristín, Margrét, Helga, Katrín, Sara', 'Jón, Sigurður, Guðmundur, Gunnar, Ólafur, Einar, Kristján, Stefán', 'Jónsson, Sigurðsson, Guðmundsson, Gunnarsson, Ólafsson, Einarsson, Kristjánsson, Stefánsson', ['is'], 'Jónsdóttir, Sigurðardóttir, Guðmundsdóttir, Gunnarsdóttir, Ólafsdóttir, Einarsdóttir, Kristjánsdóttir, Stefánsdóttir'),
  HU: kit('Eszter, Anna, Katalin, Zsófia, Réka, Dóra, Andrea, Krisztina', 'László, Gábor, Péter, Balázs, Zoltán, Tamás, Attila, Dániel', 'Nagy, Kovács, Tóth, Szabó, Horváth, Varga, Kiss, Molnár, Németh, Farkas', ['hu'], undefined, true),
  RS: kit('Jelena, Milica, Ana, Marija, Jovana, Ivana, Tamara, Dragana', 'Nikola, Marko, Stefan, Miloš, Aleksandar, Nemanja, Dušan, Vladimir', 'Jovanović, Petrović, Nikolić, Marković, Đorđević, Stojanović, Ilić, Stanković, Pavlović, Milošević', ['sr']),
  HR: kit('Ana, Ivana, Petra, Marija, Lucija, Martina, Maja, Katarina', 'Ivan, Luka, Marko, Josip, Tomislav, Ante, Matej, Filip', 'Horvat, Kovačević, Babić, Marić, Jurić, Novak, Kovačić, Knežević, Vuković, Perić', ['hr']),
  AL: kit('Ana, Elira, Klea, Arjola, Ermira, Jonida, Erisa, Dorina', 'Arben, Besnik, Ermal, Gentian, Ilir, Klodian, Endrit, Altin', 'Hoxha, Shehu, Dervishi, Leka, Gjoka, Krasniqi, Shala, Kola, Marku, Cela', ['sq', 'it']),
  // Middle East and the Caucasus
  TR: kit('Elif, Zeynep, Ayşe, Merve, Esra, Defne, Selin, Ebru', 'Mehmet, Mustafa, Ahmet, Emre, Burak, Can, Murat, Kerem', 'Yılmaz, Kaya, Demir, Şahin, Çelik, Yıldız, Yıldırım, Öztürk, Aydın, Özdemir, Arslan, Doğan', ['tr']),
  IL: kit('Noa, Tamar, Maya, Yael, Shira, Michal, Noga, Adi', 'Yosef, David, Itai, Noam, Eitan, Ariel, Omer, Yonatan', 'Cohen, Levi, Mizrahi, Peretz, Biton, Friedman, Azulay, Katz, Avraham, Dahan', ['he']),
  JO: kit('Rania, Lina, Dana, Hala, Sara, Leen, Ruba, Tala', 'Omar, Ahmad, Zaid, Khaled, Yazan, Faisal, Hamza, Laith', 'Al Khatib, Haddad, Nasser, Abu Zaid, Al Masri, Qasem, Hamdan, Odeh, Al Zoubi, Khalaf', ['ar']),
  LB: kit('Maya, Rita, Nour, Joelle, Lara, Yasmine, Carla, Rana', 'Karim, Elie, Georges, Rami, Ziad, Fadi, Nadim, Walid', 'Khoury, Haddad, Abboud, Fares, Karam, Hayek, Salameh, Maalouf, Nader, Saab', ['ar', 'fr']),
  IQ: kit('Zainab, Maryam, Noor, Huda, Rusul, Sura, Ban, Shahad', 'Ali, Hussein, Mustafa, Haider, Ahmed, Omar, Karrar, Mohammed', 'Al Jubouri, Al Obaidi, Al Dulaimi, Al Tamimi, Al Saadi, Al Rubaie, Kadhim, Al Hashimi, Jassim, Abbas', ['ar', 'ku']),
  AE: kit(GULF_F, GULF_M, 'Al Mansoori, Al Hashimi, Al Dhaheri, Al Suwaidi, Al Ketbi, Al Nuaimi, Al Mazrouei, Al Shamsi, Al Falasi, Al Marzooqi', ['ar']),
  SA: kit(GULF_F, `${GULF_M}, Faisal, Turki`, 'Al Qahtani, Al Ghamdi, Al Otaibi, Al Harbi, Al Zahrani, Al Shehri, Al Dossari, Al Mutairi, Al Shammari, Al Anazi', ['ar']),
  QA: kit(GULF_F, GULF_M, 'Al Kuwari, Al Marri, Al Sulaiti, Al Naimi, Al Mohannadi, Al Kaabi, Al Emadi, Al Hajri, Al Muhannadi, Al Khater', ['ar']),
  KW: kit(GULF_F, GULF_M, 'Al Enezi, Al Mutairi, Al Ajmi, Al Rashidi, Al Kandari, Al Hajri, Al Azmi, Al Shammari, Al Awadhi, Al Fadhli', ['ar']),
  BH: kit(GULF_F, GULF_M, 'Al Sayed, Al Jishi, Kanoo, Fakhro, Al Mahmood, Al Doseri, Al Aradi, Al Zayani, Al Mannai, Al Ansari', ['ar']),
  OM: kit(GULF_F, GULF_M, 'Al Balushi, Al Hinai, Al Rawahi, Al Harthy, Al Kindi, Al Maskari, Al Farsi, Al Riyami, Al Lawati, Al Shukaili', ['ar']),
  GE: kit('Nino, Mariam, Tamar, Ana, Salome, Ketevan, Natia, Elene', 'Giorgi, Davit, Levan, Irakli, Nikoloz, Luka, Zurab, Sandro', 'Beridze, Kapanadze, Gelashvili, Maisuradze, Giorgadze, Lomidze, Tsiklauri, Bolkvadze, Kvaratskhelia, Nozadze', ['ka', 'ru']),
  AZ: kit('Aysel, Leyla, Nigar, Gunel, Sevinj, Aynur, Narmin, Lala', 'Elvin, Rashad, Farid, Tural, Orkhan, Kamran, Elchin, Vugar', 'Mammadov, Aliyev, Hasanov, Huseynov, Guliyev, Ismayilov, Hajiyev, Rzayev, Abdullayev, Karimov', ['az', 'ru'], 'Mammadova, Aliyeva, Hasanova, Huseynova, Guliyeva, Ismayilova, Hajiyeva, Rzayeva, Abdullayeva, Karimova'),
  AM: kit('Anna, Mariam, Lilit, Ani, Narine, Gayane, Anahit, Sona', 'Aram, Armen, Davit, Hayk, Tigran, Narek, Gor, Vahe', 'Harutyunyan, Sargsyan, Hovhannisyan, Grigoryan, Petrosyan, Khachatryan, Vardanyan, Karapetyan, Gevorgyan, Hakobyan', ['hy', 'ru']),
  AF: kit('Mariam, Zahra, Fatima, Nilofar, Shabnam, Parwana, Freshta, Mursal', 'Ahmad, Mohammad, Farid, Hamid, Rahim, Javid, Naveed, Sami', 'Ahmadi, Rahimi, Karimi, Hashimi, Sultani, Noori, Haidari, Mohammadi, Wardak, Safi', ['ps', 'fa']),
  // North Africa
  EG: kit('Nour, Mariam, Salma, Yasmin, Aya, Habiba, Rana, Dina', 'Mohamed, Ahmed, Mahmoud, Mostafa, Omar, Youssef, Karim, Tarek', 'Hassan, Ibrahim, Mostafa, Abdel Rahman, El Sayed, Mahmoud, Fathy, Saleh, Mansour, Farouk', ['ar']),
  MA: kit('Salma, Imane, Khadija, Sanaa, Hajar, Meryem, Nadia, Ghita', 'Youssef, Mehdi, Hamza, Amine, Karim, Rachid, Omar, Said', 'Alaoui, Benali, El Idrissi, Bennani, Tazi, Berrada, Benjelloun, Chraibi, El Amrani, Lahlou', ['ar', 'fr']),
  DZ: kit('Amina, Lynda, Meriem, Sarah, Nesrine, Yasmine, Lamia, Samira', 'Mohamed, Amine, Karim, Sofiane, Yacine, Riad, Nassim, Mourad', 'Benali, Belkacem, Bouzid, Haddad, Mebarki, Saidi, Hamidi, Khelifi, Djebbar, Brahimi', ['ar', 'fr']),
  TN: kit('Amel, Ines, Rim, Sarra, Yosra, Hela, Mariem, Olfa', 'Mohamed, Aymen, Wassim, Skander, Mehdi, Anis, Karim, Sami', 'Ben Salah, Jlassi, Hammami, Gharbi, Mejri, Ayari, Khemiri, Dridi, Chebbi, Ben Ammar', ['ar', 'fr']),
  LY: kit('Amal, Hana, Malak, Rahma, Asma, Nisreen, Salma, Huda', 'Ali, Mohamed, Salem, Abdullah, Mustafa, Omar, Khaled, Tarek', 'Ben Omar, Al Warfalli, Al Obeidi, Zubair, Al Hassi, Al Mabrouk, Ben Halim, Al Fituri, Elmagrahi, Al Zawi', ['ar']),
  SD: kit('Amna, Fatima, Hiba, Sara, Reem, Wigdan, Tasneem, Alawia', 'Mohamed, Osman, Ahmed, Omer, Abubakr, Khalid, Mutasim, Hassan', 'Abdelrahman, Osman, Elhassan, Babiker, Elamin, Abdalla, Musa, Elsheikh, Ibrahim, Yousif', ['ar']),
  // Sub-Saharan Africa
  NG: kit('Ngozi, Chiamaka, Funmilayo, Amina, Folake, Adaeze, Zainab, Temitope', 'Chukwuemeka, Oluwaseun, Emeka, Ibrahim, Tunde, Ikechukwu, Musa, Femi', 'Adeyemi, Okafor, Okonkwo, Bello, Ibrahim, Adebayo, Eze, Nwosu, Abubakar, Ogunleye', ['yo', 'ig', 'ha']),
  GH: kit('Akosua, Ama, Abena, Efua, Adwoa, Esi, Akua, Yaa', 'Kwame, Kofi, Kwabena, Yaw, Kojo, Kwaku, Kwesi, Nana', 'Mensah, Asante, Owusu, Boateng, Osei, Agyeman, Appiah, Darko, Ofori, Addo', ['tw']),
  SN: kit('Aminata, Fatou, Awa, Mariama, Khady, Ndeye, Coumba, Astou', 'Moussa, Mamadou, Cheikh, Ousmane, Ibrahima, Abdoulaye, Modou, Pape', 'Diop, Ndiaye, Fall, Sow, Diallo, Ba, Sarr, Faye, Gueye, Mbaye', ['fr', 'wo']),
  CI: kit('Aya, Adjoua, Affoué, Mariam, Fatou, Nadège, Christelle, Awa', 'Koffi, Kouassi, Yao, Konan, Didier, Serge, Moussa, Arnaud', 'Kouassi, Koné, Kouamé, Yao, Coulibaly, Traoré, Konan, Bamba, N\'Guessan, Ouattara', ['fr', 'dyu']),
  ML: kit('Aïssata, Fatoumata, Mariam, Kadiatou, Oumou, Assitan, Rokia, Awa', 'Modibo, Boubacar, Seydou, Bakary, Souleymane, Adama, Moussa, Mamadou', 'Traoré, Keïta, Coulibaly, Diarra, Konaté, Touré, Sangaré, Cissé, Dembélé, Sidibé', ['fr', 'bm']),
  ET: kit('Selam, Hana, Meron, Tigist, Bethlehem, Liya, Mahlet, Rahel', 'Dawit, Yonas, Abel, Biniam, Samuel, Henok, Solomon, Yared', 'Tesfaye, Bekele, Girma, Haile, Tadesse, Alemu, Kebede, Wolde, Assefa, Getachew', ['am']),
  KE: kit('Wanjiku, Akinyi, Faith, Grace, Njeri, Achieng, Mercy, Chebet', 'Brian, Kevin, Dennis, Collins, Samuel, Kibet, Otieno, Kamau', 'Kamau, Otieno, Mwangi, Odhiambo, Njoroge, Wafula, Ochieng, Kariuki, Kiprono, Mutua', ['sw']),
  TZ: kit('Neema, Rehema, Upendo, Zawadi, Halima, Grace, Mwanaisha, Esther', 'Baraka, Juma, Emmanuel, Hamisi, Joseph, Athumani, Godfrey, Said', 'Mushi, Massawe, Mwakyusa, Juma, Mollel, Kimaro, Msuya, Hassan, Mrema, Shirima', ['sw']),
  UG: kit('Grace, Esther, Patience, Sarah, Brenda, Prossy, Joan, Agnes', 'Ronald, Moses, Isaac, Brian, Joseph, Denis, Ivan, Allan', 'Okello, Mukasa, Ssekandi, Tumusiime, Byaruhanga, Kato, Ochieng, Musoke, Ssempala, Kiggundu', ['sw', 'lg']),
  RW: kit('Aline, Divine, Claudine, Ange, Josiane, Solange, Diane, Clarisse', 'Jean, Eric, Patrick, Olivier, Emmanuel, Innocent, Fabrice, Didier', 'Uwimana, Mugisha, Niyonzima, Habimana, Uwase, Mukamana, Nshimiyimana, Ndayisaba, Iradukunda, Mutesi', ['rw', 'fr']),
  CD: kit('Grâce, Merveille, Esther, Divine, Nadine, Sarah, Gloria, Rachel', 'Jean-Paul, Patrick, Fiston, Christian, Héritier, Junior, Trésor, Cédric', 'Mukendi, Tshibangu, Ilunga, Kabongo, Mbuyi, Kalala, Lukusa, Mutombo, Nzuzi, Kasongo', ['fr', 'ln', 'sw']),
  CF: kit('Marie, Clarisse, Nadège, Sylvie, Brigitte, Rosine, Pélagie, Josiane', 'Jean-Pierre, Thierry, Serge, Didier, Fidèle, Hervé, Rodrigue, Blaise', 'Samba, Ngoupandé, Sarandji, Ziguélé, Dologuélé, Gaombalet, Nzapayéké, Ngrébada, Mbaïkoua, Yakété', ['fr', 'sg']),
  SS: kit('Nyandeng, Achol, Ayen, Nyabol, Abuk, Adut, Nyaluak, Akuol', 'Peter, John, Majok, Lual, Mabior, Kuol, Garang, Malith', 'Deng, Garang, Majok, Akol, Lual, Kuol, Bol, Malual, Ajak, Chol', ['ar']),
  SO: kit('Hodan, Ayaan, Amina, Faadumo, Sahra, Ifrah, Hibo, Nimco', 'Abdullahi, Mohamed, Abdirahman, Ahmed, Liban, Mahad, Abdi, Hassan', 'Mohamed, Ali, Hassan, Abdi, Warsame, Farah, Jama, Osman, Yusuf, Aden', ['so', 'ar']),
  DJ: kit('Hibo, Fatouma, Kadra, Safia, Hasna, Asma, Deka, Amina', 'Ismaël, Omar, Moussa, Abdourahman, Houssein, Ahmed, Daher, Hassan', 'Ali, Omar, Houssein, Robleh, Moussa, Daher, Abdi, Hassan, Djama, Farah', ['fr', 'so', 'ar']),
  ZA: kit('Thandiwe, Lerato, Nomvula, Zanele, Anika, Palesa, Nokuthula, Megan', 'Sipho, Thabo, Johan, Bongani, Pieter, Lwazi, Themba, Ryan', 'Nkosi, Dlamini, Ndlovu, Khumalo, Mokoena, van der Merwe, Botha, Naidoo, Mahlangu, Pretorius', ['af', 'zu']),
  NA: kit('Ndapewa, Ndeshi, Hilma, Selma, Ruusa, Maria, Frieda, Loide', 'Johannes, Petrus, Tuhafeni, Erastus, Simeon, Josef, Festus, Hilifa', 'Shikongo, Nangolo, Amutenya, Haufiku, Shilongo, Iipinge, van Wyk, Nghidinwa, Amukoto, Shivute', ['af', 'ng']),
  BW: kit('Boitumelo, Kelebogile, Onalenna, Neo, Lorato, Masego, Kefilwe, Naledi', 'Kagiso, Tumelo, Thato, Kabelo, Mpho, Oratile, Tebogo, Lesego', 'Molefe, Mosweu, Tau, Moagi, Sebina, Mothibi, Kebonang, Modise, Motsumi, Gabaake', ['tn']),
  ZW: kit('Tendai, Rutendo, Chipo, Nyasha, Rufaro, Tsitsi, Vimbai, Nokuthula', 'Tafadzwa, Tinashe, Farai, Takudzwa, Kudakwashe, Tapiwa, Tawanda, Blessing', 'Moyo, Ncube, Sibanda, Dube, Mpofu, Nyathi, Banda, Shumba, Makoni, Chikore', ['sn', 'nd']),
  ZM: kit('Chileshe, Mutale, Natasha, Mwila, Thandiwe, Bupe, Mwape, Chanda', 'Mwansa, Chola, Kelvin, Mubanga, Joseph, Musonda, Mulenga, Kennedy', 'Banda, Phiri, Mwale, Tembo, Mulenga, Zulu, Chanda, Mumba, Lungu, Bwalya', ['bem', 'ny']),
  MZ: kit('Ana, Celeste, Graça, Lurdes, Neusa, Telma, Sheila, Cátia', 'Hélio, Nelson, Armando, Edson, Celso, Abílio, Dércio, Arsénio', 'Macuácua, Sitoe, Cossa, Mondlane, Nhantumbo, Bila, Langa, Mabunda, Tembe, Machava', ['pt']),
  AO: kit('Ana, Esperança, Josefa, Luzia, Teresa, Yola, Isabel, Madalena', 'Adilson, Edvaldo, Manuel, Osvaldo, Nelson, Hélder, Mateus, Domingos', 'Domingos, Fernandes, Mateus, Kiala, Sebastião, Tavares, António, Cassoma, Paulo, Nzinga', ['pt']),
  GW: kit('Fatumata, Maimuna, Ana, Domingas, Binta, Aissatu, Mariama, Nhima', 'Braima, Mamadu, Domingos, Armando, Iaia, Carlos, Aladje, Fernando', 'Cá, Có, Té, Gomes, Mendes, Sanhá, Baldé, Djaló, Indjai, Correia', ['pt', 'fr']),
  ST: kit('Ana, Celma, Elsa, Ilza, Nilza, Sónia, Edna, Vera', 'Adelino, Arlindo, Hélder, Leonel, Osvaldo, Abel, Aurélio, Delfim', 'da Costa, Neto, Pina, Carvalho, Bonfim, Lima, Ceita, Vaz, Espírito Santo, Afonso', ['pt']),
  MU: kit('Priya, Anjali, Marie, Sabrina, Kavita, Nathalie, Vanessa, Pooja', 'Rakesh, Vikash, Jean, Kevin, Arvind, Yannick, Ravi, Laurent', 'Ramsamy, Appadoo, Moorghen, Gopaul, Ramdin, Perrine, Lagesse, Bholah, Dookhun, Seetul', ['fr', 'mfe']),
  MG: kit('Hanta, Fara, Lalao, Voahangy, Miora, Tiana, Mialy, Nirina', 'Hery, Toky, Mamy, Fidy, Rivo, Haja, Tojo, Rado', 'Rakoto, Rasoanaivo, Randrianarisoa, Rabe, Rakotomalala, Razafindrakoto, Andrianaivo, Rasolofo, Ratsimbazafy, Rakotondrabe', ['mg', 'fr']),
  SC: kit('Marie, Sabrina, Natasha, Cindy, Vanessa, Jessica, Nadia, Sandra', 'Jean, Patrick, Ronny, Kevin, Terry, Wilfred, Bernard, Gerard', 'Payet, Hoareau, Labrosse, Pillay, Morel, Larue, Esparon, Barbe, Ernesta, Mondon', ['fr', 'crs']),
  // South and South-East Asia
  IN: kit('Priya, Ananya, Kavya, Divya, Neha, Pooja, Aishwarya, Sneha', 'Rahul, Arjun, Vikram, Rohan, Aditya, Karan, Siddharth, Amit', 'Sharma, Patel, Reddy, Iyer, Nair, Singh, Gupta, Menon, Mehta, Rao, Desai, Kapoor', ['hi']),
  LK: kit('Dilini, Nadeesha, Sanduni, Tharushi, Chathurika, Ishara, Hiruni, Nimesha', 'Kasun, Nuwan, Chamara, Dinesh, Lahiru, Sanjaya, Tharindu, Ruwan', 'Perera, Fernando, Silva, de Silva, Jayasinghe, Wickramasinghe, Bandara, Gunawardena, Senanayake, Kumara', ['si', 'ta']),
  NP: kit('Sita, Anjali, Sushma, Pooja, Srijana, Asmita, Sabina, Rojina', 'Ramesh, Suman, Bikash, Prakash, Sanjay, Rajesh, Anil, Sagar', 'Shrestha, Gurung, Tamang, Thapa, Rai, Magar, Adhikari, Sharma, Karki, Poudel', ['ne']),
  BD: kit('Nusrat, Farzana, Sadia, Tasnim, Sumaiya, Ayesha, Nadia, Shirin', 'Rafiq, Tanvir, Arif, Imran, Sabbir, Mahmud, Rakib, Fahim', 'Rahman, Hossain, Ahmed, Islam, Chowdhury, Khan, Haque, Sarkar, Alam, Siddique', ['bn']),
  PK: kit('Ayesha, Fatima, Sana, Hira, Maryam, Zainab, Mahnoor, Amna', 'Ali, Bilal, Usman, Hamza, Faisal, Saad, Kashif, Adeel', 'Khan, Ahmed, Malik, Butt, Qureshi, Chaudhry, Shah, Hussain, Siddiqui, Raza', ['ur']),
  MV: kit('Aishath, Mariyam, Fathimath, Hawwa, Shifa, Shaheena, Aminath, Mausooma', 'Ahmed, Mohamed, Ibrahim, Hussain, Ali, Ismail, Hassan, Abdulla', 'Mohamed, Ahmed, Ibrahim, Hassan, Abdulla, Rasheed, Moosa, Waheed, Shareef, Naseem', ['dv']),
  SG: kit('Rachel, Michelle, Mei Ling, Hui Min, Jia Hui, Grace, Nurul, Priya', 'Wei Ming, Jun Jie, Daniel, Kelvin, Zhi Hao, Ryan, Marcus, Darren', 'Tan, Lim, Lee, Ng, Ong, Wong, Goh, Chua, Koh, Teo', ['zh', 'ms']),
  TH: kit('Siriporn, Kanya, Nattaya, Pimchanok, Supaporn, Waraporn, Ploy, Kanokwan', 'Somchai, Anan, Chaiwat, Kittisak, Prasert, Thanawat, Nattapong, Wichai', 'Saetang, Srisuk, Wongsa, Chaiyaporn, Suksawat, Rattanakorn, Boonmee, Sukjai, Phromma, Thongdee', ['th']),
  MY: kit('Nurul, Siti, Aisyah, Farah, Nur Aina, Syafiqah, Hidayah, Liyana', 'Ahmad, Hafiz, Faizal, Azman, Arif, Firdaus, Syafiq, Amir', 'Abdullah, Ismail, Rahman, Hamid, Yusof, Ibrahim, Hassan, Osman, Aziz, Othman', ['ms']),
  'MY-cn': kit('Mei Ling, Hui Min, Xin Yi, Jia Wen, Wei Ling, Pei Shan', 'Wei Jie, Jun Hao, Chee Keong, Kok Wai, Zhi Wei, Ah Meng', 'Tan, Lim, Lee, Wong, Ng, Chong, Cheah, Ooi, Teh, Yap', ['ms', 'zh']),
  ID: kit('Dewi, Siti, Putri, Ayu, Rina, Indah, Fitri, Sri', 'Budi, Agus, Andi, Rizky, Dimas, Eko, Hendra, Bayu', 'Santoso, Wijaya, Saputra, Hidayat, Pratama, Setiawan, Kusuma, Nugroho, Wibowo, Susanto', ['id']),
  PH: kit('Maria, Angelica, Kristine, Jasmine, Joy, Camille, Patricia, Bea', 'Jose, Mark, John Paul, Carlo, Miguel, Rafael, Paolo, Jericho', 'Santos, Reyes, Cruz, Bautista, Ocampo, Garcia, Mendoza, Torres, dela Cruz, Villanueva, Ramos, Aquino', ['fil']),
  VN: kit('Lan, Hương, Linh, Mai, Thảo, Trang, Ngọc, Hà', 'Minh, Tuấn, Hùng, Dũng, Nam, Quang, Đức, Long', 'Nguyễn, Trần, Lê, Phạm, Hoàng, Huỳnh, Phan, Vũ, Võ, Đặng', ['vi'], undefined, true),
  MM: kit('Thandar, Su Su, Ei Ei, Khin, Nilar, Hnin, May, Thiri', 'Kyaw, Aung, Min, Zaw, Htet, Ye, Thura, Myo', 'Aung, Win, Kyaw, Htun, Myint, Naing, Oo, Thein, Soe, Zaw', ['my']),
  KH: kit('Sreymom, Sophea, Channary, Bopha, Sokha, Sreyneang, Chanthou, Rachana', 'Dara, Sophal, Vuthy, Rithy, Visal, Sokun, Piseth, Vannak', 'Sok, Chan, Kim, Heng, Ly, Meas, Chea, Keo, Seng, Phan', ['km'], undefined, true),
  TL: kit('Maria, Ana, Joana, Rosa, Lúcia, Filomena, Natália, Ermelinda', 'José, João, Francisco, Domingos, Agostinho, Mateus, Abílio, Nélio', 'da Costa, Soares, Pereira, Guterres, Ximenes, Amaral, Freitas, Martins, dos Santos, da Silva', ['tet', 'pt']),
  // East Asia
  CN: kit('Fang, Jing, Li Na, Xiaoyan, Mei, Yan, Xue, Ting', 'Wei, Jun, Lei, Hao, Ming, Tao, Qiang, Yong', 'Wang, Li, Zhang, Liu, Chen, Yang, Huang, Zhao, Wu, Zhou', ['zh'], undefined, true),
  HK: kit('Karen, Winnie, Michelle, Carmen, Vivian, Joyce, Cecilia, Iris', 'Kelvin, Raymond, Kenneth, Alan, Edmund, Jason, Ivan, Wilson', 'Chan, Wong, Leung, Lee, Cheung, Lau, Ho, Lam, Ng, Tsang', ['zh']),
  MO: kit('Sandra, Ivy, Carmen, Cindy, Joanna, Teresa, Kitty, Sónia', 'Ricardo, Kelvin, Ivan, Jacky, Sam, Nelson, Hugo, Tony', 'Leong, Chan, Wong, Lei, Ho, Lam, Cheong, Choi, Lou, Sou', ['zh', 'pt']),
  TW: kit('Yi-Ting, Shu-Fen, Ya-Wen, Hsin-Yi, Pei-Shan, Mei-Ling, Yu-Chen, Hui-Ju', 'Chia-Hao, Chih-Ming, Wei-Lun, Chun-Hung, Yu-Hsiang, Cheng-Han, Kuan-Ting, Po-Wei', 'Chen, Lin, Huang, Chang, Lee, Wang, Wu, Liu, Tsai, Yang', ['zh']),
  JP: kit('Yuki, Haruka, Aiko, Sakura, Yui, Misaki, Nanami, Ayaka', 'Hiroshi, Takumi, Kenji, Daiki, Haruto, Shota, Ryo, Yuto', 'Sato, Suzuki, Takahashi, Tanaka, Watanabe, Ito, Yamamoto, Nakamura, Kobayashi, Kato', ['ja']),
  KR: kit('Ji-woo, Seo-yeon, Min-ji, Su-bin, Ha-eun, Ye-jin, Ji-eun, Yu-na', 'Min-jun, Ji-hoon, Seo-jun, Hyun-woo, Dong-hyun, Jae-won, Sung-min, Tae-yang', 'Kim, Lee, Park, Choi, Jung, Kang, Cho, Yoon, Jang, Lim', ['ko'], undefined, true),
  // Oceania
  AU: kit('Chloe, Emily, Jessica, Sarah, Olivia, Mia, Georgia, Kate', 'Jack, Lachlan, Josh, Liam, Mitchell, Tom, Hamish, Riley', 'Smith, Jones, Williams, Brown, Wilson, Taylor, Nguyen, Kelly, Ryan, Walker, Mitchell, Campbell'),
  NZ: kit('Aroha, Isla, Charlotte, Ruby, Hana, Olivia, Mereana, Sophie', 'Tama, James, Oliver, Nikau, Liam, Hamish, Wiremu, Sam', 'Smith, Wilson, Williams, Brown, Taylor, Thompson, Ngata, Parata, Tipene, Henare', ['mi']),
  FJ: kit('Mere, Litia, Ana, Losana, Vika, Salote, Akanisi, Asenaca', 'Josua, Viliame, Semi, Jone, Waisale, Peceli, Sakiusa, Ratu', 'Serevi, Radradra, Tuisova, Mata, Nakarawa, Masirewa, Ravouvou, Waqa, Kolinisau, Tuwai', ['fj', 'hif']),
  PF: kit('Hinatea, Moana, Vaimiti, Tiare, Heiata, Manon, Teura, Poerava', 'Teva, Tehau, Raitini, Heimana, Mateo, Kevin, Tamatea, Manutea', 'Tetuanui, Temarii, Teriitahi, Tehei, Tauotaha, Teriitehau, Lehartel, Bambridge, Sanford, Maihi', ['fr', 'ty']),
  NC: kit('Léa, Manon, Chloé, Kiara, Marie, Wakaya, Laura, Sandrine', 'Hugo, Théo, Kevin, Jean-Marc, Yannick, Wanir, Steeve, Christophe', 'Wamytan, Wéa, Goa, Naisseline, Kasarhérou, Martin, Bernard, Dubois, Lafleur, Gomès', ['fr']),
  WS: kit('Sina, Lagi, Mele, Tina, Losa, Fetu, Malia, Lupe', 'Tavita, Iosefa, Pita, Malo, Fiti, Sefo, Ioane, Mikaele', 'Tuilagi, Leota, Faleolo, Sapolu, Fonoti, Tauiliili, Aiono, Tofilau, Leavasa, Schmidt', ['sm']),
  CK: kit('Tuaine, Mere, Ngaire, Moana, Tiare, Teina, Mii, Vaine', 'Tama, Teariki, Tangi, Tutai, Ruatoka, Mataio, Tuaine, Pa', 'Tangaroa, Marsters, Pera, Tuara, George, Puna, Tetava, Tupa, Mataio, Brown', ['rar']),
  GU: kit('Maria, Christine, Jennifer, Rose, Leah, Tricia, Annie, Josephine', 'Joseph, John, Vincent, Jesse, Francisco, Ray, Joaquin, Peter', 'Cruz, Santos, Camacho, Taitano, Aguon, Leon Guerrero, Quinata, Flores, Perez, San Nicolas', ['ch']),
  // The Americas
  US: kit('Jessica, Ashley, Emily, Sarah, Megan, Lauren, Amanda, Rachel', 'Michael, Chris, Matt, Josh, David, Ryan, Tyler, Brandon', 'Smith, Johnson, Williams, Brown, Jones, Garcia, Miller, Davis, Rodriguez, Martinez, Anderson, Thomas'),
  CA: kit('Emily, Sarah, Megan, Jessica, Ashley, Hannah, Lauren, Kayla', 'Liam, Ethan, Ryan, Connor, Tyler, Matthew, Josh, Kyle', 'Smith, Brown, Wilson, MacDonald, Taylor, Campbell, Anderson, Johnson, Martin, Thompson'),
  'CA-fr': kit('Émilie, Catherine, Geneviève, Marie-Ève, Julie, Audrey, Isabelle, Valérie', 'Mathieu, Alexandre, Maxime, Jean-François, Simon, Gabriel, Étienne, Philippe', 'Tremblay, Gagnon, Roy, Côté, Bouchard, Gauthier, Morin, Lavoie, Fortin, Gagné', ['fr']),
  MX: kit('Guadalupe, Fernanda, Daniela, Ximena, Valeria, Mariana, Alejandra, Gabriela', 'José Luis, Alejandro, Juan Carlos, Diego, Luis, Eduardo, Arturo, Rodrigo', 'Hernández, García, Martínez, López, González, Rodríguez, Pérez, Sánchez, Ramírez, Flores', ['es']),
  AR: kit('Florencia, Agustina, Camila, Sofía, Lucía, Valentina, Micaela, Julieta', 'Martín, Santiago, Matías, Facundo, Nicolás, Juan Pablo, Lucas, Gonzalo', 'González, Rodríguez, Gómez, Fernández, López, Díaz, Martínez, Pérez, Romero, Sosa', ['es']),
  CL: kit('Constanza, Javiera, Francisca, Catalina, Fernanda, Valentina, Camila, Daniela', 'Benjamín, Vicente, Cristóbal, Matías, Sebastián, Felipe, Tomás, Ignacio', 'González, Muñoz, Rojas, Díaz, Pérez, Soto, Contreras, Silva, Martínez, Sepúlveda', ['es']),
  CO: kit('Daniela, Valentina, Laura, Natalia, Paola, Andrea, Juliana, Catalina', 'Andrés, Juan Sebastián, Santiago, Camilo, Felipe, Julián, Mauricio, Carlos', 'Rodríguez, Gómez, González, Martínez, García, López, Hernández, Sánchez, Ramírez, Jaramillo', ['es']),
  PE: kit('Rosa, Milagros, Lucía, Gabriela, Fiorella, Andrea, Carmen, Ximena', 'Luis, Jorge, Renzo, Diego, Piero, César, Miguel, Alonso', 'Quispe, Flores, Sánchez, Rodríguez, García, Rojas, Huamán, Mamani, Torres, Chávez', ['es', 'qu']),
  LATAM: kit(LATAM_F, LATAM_M, 'González, Rodríguez, Martínez, Hernández, López, García, Pérez, Sánchez, Ramírez, Torres, Castillo, Morales', ['es']),
  CARIB: kit('Shanice, Kimberly, Tamika, Keisha, Danielle, Simone, Ashley, Kerry-Ann', 'Andre, Marlon, Dwayne, Kemar, Ricardo, Jermaine, Damian, Shane', 'Rolle, Ferguson, Knowles, Johnson, Smith, Brown, Campbell, Thompson, Williams, Clarke, Francis, Grant'),
  AW: kit('Natasha, Jennifer, Maria, Giselle, Evelyn, Sharon, Melissa, Jacqueline', 'Ricardo, Juan, Edwin, Mike, Richard, Ryan, Glenbert, Eric', 'Croes, Kock, Maduro, Geerman, Tromp, Werleman, Wever, Arends, Lacle, Dijkhoff', ['pap', 'nl', 'es']),
};

/** The kits a country's people are drawn from (one kit per name, never mixed). A country with its own kit uses it. */
export const CALLER_KITS: Record<string, string[]> = {
  BE: ['BE-nl', 'BE-nl', 'BE-fr'],
  CH: ['CH-de', 'CH-de', 'CH-fr', 'CH-it'],
  LU: ['LU', 'LU', 'FR'],
  CA: ['CA', 'CA', 'CA-fr'],
  MY: ['MY', 'MY', 'MY-cn'],
  PR: ['LATAM'], DO: ['LATAM'], CU: ['LATAM'], EC: ['LATAM'], PA: ['LATAM'], CR: ['LATAM'], SV: ['LATAM'], GT: ['LATAM'],
  VE: ['LATAM'], BO: ['LATAM'], UY: ['LATAM'], PY: ['LATAM'],
  BS: ['CARIB'], JM: ['CARIB'],
};
