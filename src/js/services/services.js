import * as d3fetch from 'd3-fetch';
import * as d3dispatch from 'd3-dispatch';

import {Object} from '../lib.js';

import {esearch, esummary, elink} from './eutils-config.js';
import {
  getTaxidFromEutils, getTaxids, setTaxidAndAssemblyAndChromosomes,
  setTaxidData
} from './organisms.js';

var d3 = Object.assign({}, d3fetch, d3dispatch);

/**
 * Searches NCBI EUtils for the common organism name for this ideogram
 * instance's taxid (i.e. NCBI Taxonomy ID)
 *
 * @param callback Function to call upon completing ESearch request
 */
function getOrganismFromEutils(callback) {
  var organism, taxonomySearch, taxid,
    ideo = this;

  taxid = ideo.config.organism;

  taxonomySearch = ideo.esummary + '&db=taxonomy&id=' + taxid;

  d3.json(taxonomySearch).then(function(data) {
    organism = data.result[String(taxid)].commonname;
    ideo.config.organism = organism;
    return callback(organism);
  });}

/**
 * Returns names and lengths of chromosomes for an organism's best-known
 * genome assembly, or for a specified assembly.  Gets data from NCBI
 * EUtils web API.
 *
 * @param callback Function to call upon completion of this async method
 * @param recovering Boolean indicating attempt at failure recovery
 */
function getAssemblyAndChromosomesFromEutils(callback, recovering) {
  var asmAndChrArray, assembly, organism, assemblyAccession, chromosomes,
    termStem, asmSearch, asmUid, asmSummary, rsUid, gbUid, nuccoreLink,
    links, ntSummary, qs, results, result, cnIndex, chrName, chrLength,
    chromosome, type,
    ideo = this;

  organism = ideo.config.organism;

  asmAndChrArray = [];
  chromosomes = [];

  if (ideo.assemblyIsAccession()) {
    termStem = ideo.config.assembly + '%22[Assembly%20Accession]';
  } else {
    termStem = (
      organism + '%22[organism]' +
      'AND%20(%22latest%20refseq%22[filter])%20'
    );
  }

  asmSearch =
    ideo.esearch +
    '&db=assembly' +
    '&term=%22' + termStem +
    'AND%20(%22chromosome%20level%22[filter]%20' +
    'OR%20%22complete%20genome%22[filter])';

  var promise = d3.json(asmSearch);

  promise
    .then(function(data) {
      // NCBI Assembly database's internal identifier (uid) for this assembly
      asmUid = data.esearchresult.idlist[0];
      asmSummary = ideo.esummary + '&db=assembly&id=' + asmUid;

      return d3.json(asmSummary);
    })
    .then(function(data) {
      assembly = data.result[asmUid];

      rsUid = assembly.rsuid; // RefSeq UID for this assembly
      gbUid = assembly.gbuid; // GenBank UID
      assemblyAccession = assembly.assemblyaccession;

      asmAndChrArray.push(assemblyAccession);

      // Get a list of IDs for the chromosomes in this genome.
      //
      // If this is our first pass, or if assembly is GenBank-only, or if
      // a GenBank assembly was explicitly requested (GCA_), then query RefSeq
      // sequences in Nucleotide DB.  Otherwise, query the lesser-known
      // GenColl (Genomic Collections) DB.
      if (
        'assembly' in ideo.config && /GCA_/.test(ideo.config.assembly) ||
        typeof recovering !== 'undefined'
      ) { // TODO: account for GenBank-only
        qs = '&db=nuccore&linkname=gencoll_nuccore_chr&from_uid=' + gbUid;
      } else {
        qs = '&db=nuccore&linkname=assembly_nuccore_refseq&from_uid=' + asmUid;
      }
      nuccoreLink = ideo.elink + qs;

      return d3.json(nuccoreLink);
    })
    .then(function(data) {
      if (data.linksets[0].linksetdbs[0].links.length > 100) {
        // If the list of presumed chromosomes is longer than 100 elements, then
        // we've likely fetched scaffolds instead of chromosomes.  This
        // happens with e.g. Sus scrofa (pig).  Try recovering once via a
        // different query, and throw an error upon any subsequent failure.
        if (typeof recovering === 'undefined') {
          ideo.getAssemblyAndChromosomesFromEutils(callback, true);
          return Promise.reject(
            'Unexpectedly found genomic scaffolds instead of chromosomes ' +
            'while querying RefSeq.  Recovering.'
          );
        } else {
          // Avoid flooding NCBI with EUtils requests.
          throw Error(
            'Failed to find chromosomes for genome ' + assemblyAccession
          );
        }
      }
      links = data.linksets[0].linksetdbs[0].links.join(',');
      ntSummary = ideo.esummary + '&db=nucleotide&id=' + links;

      return d3.json(ntSummary);
    })
    .then(function(data) {
      results = data.result;

      for (var x in results) {
        result = results[x];

        // omit list of result uids
        if (x === 'uids') {
          continue;
        }

        if (result.genome === 'mitochondrion') {
          if (ideo.config.showNonNuclearChromosomes) {
            type = result.genome;
            cnIndex = result.subtype.split('|').indexOf('plasmid');
            if (cnIndex === -1) {
              chrName = 'MT';
            } else {
              // Seen in e.g. rice genome IRGSP-1.0 (GCF_001433935.1),
              // From https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?retmode=json&db=nucleotide&id=996703432,996703431,996703430,996703429,996703428,996703427,996703426,996703425,996703424,996703423,996703422,996703421,194033210,11466763,7524755
              // genome: 'mitochondrion',
              // subtype: 'cell_line|plasmid',
              // subname: 'A-58 CMS|B1',
              chrName = result.subname.split('|')[cnIndex];
            }
          } else {
            continue;
          }
        } else if (
          result.genome === 'chloroplast' ||
          result.genome === 'plastid'
        ) {
          type = 'chloroplast';
          // Plastid encountered with rice genome IRGSP-1.0 (GCF_001433935.1)
          if (ideo.config.showNonNuclearChromosomes) {
            chrName = 'CP';
          } else {
            continue;
          }
        } else if (result.genome === 'apicoplast') {
          type = 'apicoplast';
          if (ideo.config.showNonNuclearChromosomes) {
            chrName = 'AP';
          } else {
            continue;
          }
        } else {
          type = 'nuclear';

          cnIndex = result.subtype.split('|').indexOf('chromosome');

          chrName = result.subname.split('|')[cnIndex];

          if (
            typeof chrName !== 'undefined' &&
            chrName.substr(0, 3) === 'chr'
          ) {
            // Convert "chr12" to "12", e.g. for banana (GCF_000313855.2)
            chrName = chrName.substr(3);
          }
        }

        chrLength = result.slen;

        chromosome = {
          name: chrName,
          length: chrLength,
          type: type
        };

        chromosomes.push(chromosome);
      }

      chromosomes = chromosomes.sort(Ideogram.sortChromosomes);
      asmAndChrArray.push(chromosomes);

      ideo.coordinateSystem = 'bp';

      return callback(asmAndChrArray);
    }, function(rejectedReason) {
      console.warn(rejectedReason);
    });
}

export {
  esearch, esummary, elink,
  getTaxidFromEutils, getOrganismFromEutils, getTaxids,
  setTaxidAndAssemblyAndChromosomes, setTaxidData,
  getAssemblyAndChromosomesFromEutils
}
